# Local Development

## Command Reference

Make sure to follow the steps outlined in the rest of this file before using these commands.

| Description                 | Command         | Note                                               |
| --------------------------- | --------------- | -------------------------------------------------- |
| Build the canister          | make build      |                                                    |
| Start the local replica     | make start      |                                                    |
| Start the frontend server   | npm start       |                                                    |
| Deploy the canister locally | make dev_deploy |                                                    |
| Run e2e tests               | make e2e_test   | If you're using Ubuntu, it must be an LTS version. |

## System Dependencies

- Install [DFX](https://internetcomputer.org/docs/current/developer-docs/setup/install/).
- Install [NodeJS](https://nodejs.org/).
- Install [Rust](https://www.rust-lang.org/).
- Install [Docker](https://www.docker.com/).
- Install [Git](https://git-scm.com/).

## First Time Setup

Clone the Taggr repo:

```shell
git clone git@github.com:TaggrNetwork/taggr.git
```

Change your directory to the newly cloned Taggr repo:

```shell
cd taggr
```

The remaining steps are only necessary for deploying NNS canisters locally. This makes it easier to test new account creation with Internet Identity or to make ICP transfers to those accounts. Alternatively, you can [create a backup](#creating-and-restoring-backups) and then refer to the [command reference](#command-reference) to build and deploy.

Create or edit `~/.config/dfx/networks.json`, and add the following, note that `dfx install` requires port `8080` to work:

```json
{
  "local": {
    "bind": "127.0.0.1:8080",
    "type": "ephemeral",
    "replica": {
      "subnet_type": "system"
    }
  }
}
```

Stop DFX if it's running:

```shell
dfx stop
```

Start DFX with a clean environment:

```shell
dfx start --clean --background
```

Install NNS canisters (see the [DFX docs](https://github.com/dfinity/sdk/blob/master/docs/cli-reference/dfx-nns.md)):

```shell
dfx nns install
```

Now you are ready to create a new Taggr account with Internet Identity locally. If you also want to make ICP transfers to this account then continue with the remaining steps.

Set up the private key for the local minting account:

```shell
cat <<EOF >~/.config/dfx/local-minter.pem
-----BEGIN EC PRIVATE KEY-----
MHQCAQEEICJxApEbuZznKFpV+VKACRK30i6+7u5Z13/DOl18cIC+oAcGBSuBBAAK
oUQDQgAEPas6Iag4TUx+Uop+3NhE6s3FlayFtbwdhRVjvOar0kPTfE/N8N6btRnd
74ly5xXEBNSXiENyxhEuzOZrIWMCNQ==
-----END EC PRIVATE KEY-----
EOF
```

Import the key into DFX:

```shell
dfx identity import local-minter ~/.config/dfx/local-minter.pem
```

Change to the new identity in DFX:

```shell
dfx identity use local-minter
```

Stop running DFX, Taggr is setup with the assumption that DFX runs on port `55554` so use the `make start` command from now on to start DFX:

```shell
dfx stop
```

At this point, you can refer to the [command reference](#command-reference) to deploy and run Taggr, create a new account and grab your account ID. Then you can transfer ICP to that account with this command:

```shell
dfx ledger transfer --memo 1000 --amount 10 ${accountId}
```

## Creating and Restoring backups

1. Pull the backup from Taggr (heap only):

   - As a stalwart, in the browser console, execute:
     ```js
     api.call("heap_to_stable");
     ```
   - Locally run:
     ```shell
     ./backup.sh /path/to/backup
     ```

2. Restore the backup to the local canister:
   ```shell
   ./backup.sh /path/to/backup restore
   ```
