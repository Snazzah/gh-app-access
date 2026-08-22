# @snazzah/gh-app-access

A small CLI took to clone with a GitHub App for private repos using a credential helper.

[Make a new GitHub App](https://github.com/settings/apps/new). Give it `Contents: Read-only` repository permission, install it on the repositories you need. Then do `npx @snazzah/gh-app-access setup` with the App ID and private key, and now you can clone with `npx @snazzah/gh-app-access clone owner/private-repo` or configure an existing repo with `npx @snazzah/gh-app-access configure`.

Note: I made this quickly for my own purposes.
