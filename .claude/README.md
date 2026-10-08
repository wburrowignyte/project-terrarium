# .claude settings

`settings.json` registers the `ignyte-dev` plugin marketplace and enables the `context-guard` plugin.

## Required access

The marketplace source is `wburrowignyte/isdc`, a **private** repository. Anyone (or any cloud session) loading this project needs read access to it through their GitHub connection.

Without access, the marketplace fails to clone and `context-guard` does not load. It fails quietly: the session starts normally with no plugin. To check, run `claude plugin marketplace list` and `claude plugin list`; `ignyte-dev` and `context-guard@ignyte-dev` should appear.

To fix it, request read access to the repository, or add it to the session with your GitHub connection's repository access settings.
