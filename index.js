const axios = require('axios');
const beautify = require('json-beautify');
const fs = require('fs');
const path = require('path');
const toml = require('toml');
const qs = require('querystring');
const sleep = require('await-sleep');
let argv = require('yargs')
	.usage('$0 [flags]')
	.example('$0 --export-apps', 'exports all applications')
	.example('$0 --import-apps', 'import exported application zips')
	.option('export-apps', {
		alias: 'export-apps',
		describe: 'export all applications',
		type: 'boolean',
		nargs: 0,
	})
	.options('import-apps', {
		alias: 'import-apps',
		describe: 'import applications',
		type: 'boolean',
		nargs: 0,
	})
	.help('help').argv;

const StreamZip = require('node-stream-zip');
const FormData = require('form-data');

const winston = require('winston');
const moment = require('moment-timezone');

const ENVIRONMENT_CONF = toml.parse(fs.readFileSync(path.join(__dirname, 'environment.toml'), 'utf-8'));
const LOG = ENVIRONMENT_CONF['log'];

// ignore ssl verifications
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

/*
 *
 * specified winston logger format will contain the following pattern
 * LEVEL :: MESSAGE
 *
 * NOTE: haven't appended the time since this is executed at the client side
 *
 * two log files will be created at the time of execution
 * 1. import-export-error.log : only contains the error logs of the server
 * 2. import-export.log : contains both error and other levels of logs
 *
 */

const appendTimestamp = winston.format((info, opts) => {
	info.timestamp = moment().format();
	return info;
});

const loggerFormat = winston.format.printf((info) => {
	return `${info.timestamp} ${info.level.toUpperCase()} :: ${info.message}`;
});

const logger = winston.createLogger({
	format: winston.format.combine(appendTimestamp({}), loggerFormat),
	transports: [
		new winston.transports.File({
			filename: path.join(__dirname, 'logs', 'import-export-error.log'),
			level: 'error',
		}),
		new winston.transports.File({
			filename: path.join(__dirname, 'logs', 'import-export.log'),
			level: 'debug',
		}),
		new winston.transports.Console({ level: 'debug' }),
	],
	exitOnError: false,
});

/**
 * method to register a dynamic client
 *
 * @returns dynamic client registration response
 */
async function registerClient() {
	try {
		logger.info('registering a dynamic client');

		let request_dcr = {
			callbackUrl: ENVIRONMENT_CONF.dynamic_client_registration.callback_url,
			clientName: ENVIRONMENT_CONF.dynamic_client_registration.client_name,
			owner: ENVIRONMENT_CONF.dynamic_client_registration.owner,
			grantType: ENVIRONMENT_CONF.dynamic_client_registration.grant_types,
			saasApp: ENVIRONMENT_CONF.dynamic_client_registration.saas_app,
		};

		let response_dcr = await axios.post(
			`${ENVIRONMENT_CONF['apim']['hostname']}/client-registration/v0.17/register`,
			request_dcr,
			{
				headers: {
					'Content-Type': 'application/json',
					Authorization:
						'Basic ' +
						new Buffer.from(ENVIRONMENT_CONF.username + ':' + ENVIRONMENT_CONF.password).toString('base64'),
				},
			}
		);

		if (LOG.response) {
			logger.debug(beautify(response_dcr.data, null, 4));
		}

		logger.info(
			`dynamic client registered -> client_id: ${response_dcr.data.clientId} & client_secret: ${response_dcr.data.clientSecret}`
		);

		return response_dcr.data;
	} catch (error) {
		logger.error(error);
	}
}

/**
 * method to generate access token
 *
 * @param {string} client_id consumer key of the client
 * @param {string} client_secret consumer secret of the client
 * @returns access token response
 */
async function generateToken(client_id, client_secret) {
	try {
		logger.info('generating accesss token');

		let request_token = {
			grant_type: 'password',
			username: ENVIRONMENT_CONF.username,
			password: ENVIRONMENT_CONF.password,
			scope: ENVIRONMENT_CONF.scopes,
		};

		let response_token = await axios.post(
			`${ENVIRONMENT_CONF['apim']['hostname']}/oauth2/token`,
			qs.stringify(request_token),
			{
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					Authorization: 'Basic ' + new Buffer.from(client_id + ':' + client_secret).toString('base64'),
				},
			}
		);

		if (LOG.response) {
			logger.debug(beautify(response_token.data, null, 4));
		}

		logger.info(`generated access token -> access_token: ${response_token.data.access_token}`);

		return response_token.data;
	} catch (error) {
		logger.error(error);
	}
}

/**
 * method to list all applications
 *
 * @param {string} access_token access token
 * @returns application list response
 */
async function listApplications(access_token) {
	try {
		logger.info('listing all applications');

		let response_applications = await axios.get(
			`${ENVIRONMENT_CONF['apim']['hostname']}/api/am/admin/v1/applications`,
			{
				headers: {
					Authorization: 'Bearer ' + access_token,
				},
			}
		);

		if (LOG.response) {
			logger.debug(beautify(response_applications.data, null, 4));
		}

		return response_applications.data;
	} catch (error) {
		logger.error(error);
	}
}

/**
 * method to export the application
 *
 * @param {string} access_token access token
 * @param {string} name application name
 * @param {string} owner application owner
 */
async function exportApplication(access_token, name, owner) {
	try {
		logger.info(`exporting application ${owner}:${name}`);

		await sleep(1000);

		let response_export = await axios.get(
			`${ENVIRONMENT_CONF['apim']['hostname']}/api/am/admin/v1/export/applications?` +
				`appName=${name}&` +
				`appOwner=${owner}&` +
				`withKeys=${ENVIRONMENT_CONF['export']['withKeys']}`,
			{
				headers: {
					Authorization: 'Bearer ' + access_token,
				},
				responseType: 'arraybuffer',
			}
		);

		if (!fs.existsSync(path.join(__dirname, 'exported'))) {
			fs.mkdirSync(path.join(__dirname, 'exported'));
		}

		await fs.promises.writeFile(
			path.join(__dirname, 'exported', owner + '_' + name + '.zip'),
			response_export.data
		);

		logger.info(`application exported ${owner}:${name}`);
	} catch (error) {
		logger.error(error);
	}
}

/**
 * method to import the application
 *
 * @param {string} access_token access_token
 */
async function importApplication(access_token) {
	try {
		logger.info('starting to import applications');

		let zips = await fs.readdirSync(path.join(__dirname, 'exported'));

		zips = zips.filter((x) => x.includes('.zip'));
		logger.info(`application zips -> [${zips.join(', ')}]`);

		for (let z of zips) {
			let zip = new StreamZip.async({ file: path.join(__dirname, 'exported', z) });

			let name = z.split('_')[1].split('.')[0];
			let owner = z.split('_')[0];

			let zip_data = await zip.entryData(name + '/' + name + '.json');
			let metadata = JSON.parse(zip_data.toString());

			if (LOG.debug) {
				logger.debug(`metadata of ${name}.json`);
				logger.debug(beautify(metadata, null, 4));
			}

			await zip.close();

			// import application

			logger.info(`importing application ${owner}:${name}`);

			let formdata = new FormData();
			formdata.append('file', fs.readFileSync(path.join(__dirname, 'exported', z)));
			let response_import = await axios.post(
				`${ENVIRONMENT_CONF['apim']['hostname']}/api/am/admin/v1/import/applications?` +
					`preserveOwner=${ENVIRONMENT_CONF['import']['preserveOwner']}&` +
					`skipSubscriptions=${ENVIRONMENT_CONF['import']['skipSubscriptions']}&` +
					`appOwner=${owner}&` +
					`skipApplicationKeys=${ENVIRONMENT_CONF['import']['skipApplicationKeys']}&` +
					`update=${ENVIRONMENT_CONF['import']['update']}`,
				formdata,
				{
					headers: {
						'Content-Type': 'multipart/form-data',
						Authorization: 'Bearer ' + access_token,
					},
				}
			);

			if (LOG.response) {
				logger.debug(beautify(response_import.data, null, 4));
			}

			let applicationId = response_import.data.applicationId;
			logger.info(`application imported ${owner}:${name} -> ${applicationId}`);

			// map existing oauth keys

			for (let keymanager of ENVIRONMENT_CONF['keymanagers']) {
				if (
					metadata.keyManagerWiseOAuthApp &&
					metadata.keyManagerWiseOAuthApp.PRODUCTION &&
					metadata.keyManagerWiseOAuthApp.PRODUCTION[keymanager]
				) {
					await mapOauthKeys(metadata, applicationId, keymanager, 'PRODUCTION', access_token);
				}

				if (
					metadata.keyManagerWiseOAuthApp &&
					metadata.keyManagerWiseOAuthApp.SANDBOX &&
					metadata.keyManagerWiseOAuthApp.SANDBOX[keymanager]
				) {
					await mapOauthKeys(metadata, applicationId, keymanager, 'SANDBOX', access_token);
				}
			}
		}
	} catch (error) {
		logger.error(error);
	}
}

/**
 * method to map the application keys with the application
 *
 * @param {string} metadata exported application metadata
 * @param {string} applicationId application id
 * @param {string} keymanager keymanager ID or name
 * @param {string} keytype key type -> PRODUCTION or SANDBOX
 * @param {string} access_token access token
 */
async function mapOauthKeys(metadata, applicationId, keymanager, keytype, access_token) {
	logger.info(`mapping oauth keys to application: ${applicationId}`);

	await sleep(1000);

	let key = metadata.keyManagerWiseOAuthApp[keytype][keymanager];

	let clientSecret = new Buffer.from(key.clientSecret, 'base64').toString('ascii');
	let request_map = {
		consumerKey: key.clientId,
		consumerSecret: clientSecret,
		keyManager: keymanager,
		keyType: keytype,
	};

	if (LOG.debug) {
		logger.debug(`${applicationId} -> ${key.clientId}:${clientSecret} | ${keymanager} | ${keytype}`);
	}

	let response_map = await axios.post(
		`${ENVIRONMENT_CONF['apim']['hostname']}/api/am/store/v1/applications/${applicationId}/map-keys`,
		request_map,
		{
			headers: {
				'Content-Type': 'application/json',
				Authorization: 'Bearer ' + access_token,
			},
		}
	);

	if (LOG.response) {
		logger.debug(beautify(response_map.data, null, 4));
	}

	logger.info(`keys mapped successfully -> ${applicationId}`);
}

/**
 * method to revoke the access token
 *
 * @param {string} access_token access token
 * @param {string} client_id consumer key of the client
 * @param {string} client_secret consumer secret of the client
 */
async function revokeToken(access_token, client_id, client_secret) {
	try {
		logger.info(`revoking the access token: ${access_token}`);

		let request_revoke = {
			token: access_token,
		};
		let response_revoke = await axios.post(
			`${ENVIRONMENT_CONF['apim']['hostname']}/oauth2/revoke`,
			qs.stringify(request_revoke),
			{
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					Authorization: 'Basic ' + new Buffer.from(client_id + ':' + client_secret).toString('base64'),
				},
			}
		);

		if (LOG.response) {
			logger.debug(beautify(response_revoke.data, null, 4));
		}

		logger.info(`token revoked -> ${access_token}`);
	} catch (error) {
		logger.error(error);
	}
}

async function main() {
	if (argv['import-apps'] || argv['export-apps']) {
		logger.info('-- starting import-export-nodejs --');

		let response_dcr = await registerClient();
		let response_token = await generateToken(response_dcr.clientId, response_dcr.clientSecret);

		let access_token = response_token.access_token;
		if (argv['export-apps']) {
			let response_applications = await listApplications(access_token);
			for (let application of response_applications.list) {
				await exportApplication(access_token, application.name, application.owner);
			}
		}

		if (argv['import-apps']) {
			await importApplication(access_token);
		}

		await revokeToken(access_token, response_dcr.clientId, response_dcr.clientSecret);
	}

	if (!(argv['import-apps'] || argv['export-apps'])) {
		logger.warn('no flags specified. use --help to list example commands');
	}
}

main();
