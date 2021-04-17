# Import Export App WSO2

A NodeJS CLI tool to import and export applications in WSO2 API Manager v3.2.0. This tool uses the WSO2 API Manager Admin REST APIs to export all the applications at once and also to import all exported Applications at once.

> This tool is developed and tested with WSO2 API Manager v3.2.0. NodeJS `v12.16.2` used for development.

## Build & Usage

### Build

Execute the following command from the root directory of the project to install the dependencies

```sh
npm i
```

Once the installation is successful, execute the following comamnd to link the tool in your environment

```sh
npm link
```

### Usage

#### Configurations

The `environment.toml` is used to configure the tool to communicate and perform the import and export operations. Given below is a set of available configurations

```toml
username = 'admin'  # super admin username
password = 'admin'  # super admin password
scopes = 'apim:admin apim:app_import_export apim:app_owner_change apim:subscribe apim:app_manage'
keymanagers = ['Keycloak']  # key managers list in the api manager server

[apim]
hostname = 'https://localhost:9443' # api manager server hostname

# export application configurations
[export]
withKeys = true

# import application configurations
[import]
preserveOwner = true
skipSubscriptions = true
skipApplicationKeys = true
update = false

# dynamic client registration configurations
[dynamic_client_registration]
client_name = 'import_export_nodejs'
callback_url = 'http://localhost'
owner = 'admin'
grant_types = 'password refresh_token'
saas_app = true

# winston logger configurations
[log]
debug = true
response = false
```

#### Commands

```sh
index.js [flags]

Options:
  --version  Show version number                                       [boolean]
  --help     Show help                                                 [boolean]

Examples:
  index.js --export-apps  exports all applications
  index.js --import-apps  import exported application zips
```

##### Export All Application

The following command is used to export all the applications of an environment. The applications are exported as zip artifacts and stored inside a folder named `exported` in the root directory of the project

```sh
import-export-app-wso2 --export-apps
```

##### Import All Applications

The following command is used to import the exported applications. The exported application zips should be placed in a directory named `exported` in the project directory.

```sh
import-export-app-wso2 --import-apps
```

## License

[MIT License](LICENSE)
