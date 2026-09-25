#!/bin/sh
# Run a command under the repo mise env while preserving caller-set values for
# the variables mise.toml manages. mise 2026.9.13 replaces caller-supplied
# values with { default } entries (https://github.com/jdx/mise/issues/13630);
# restoring them after `mise exec` keeps caller > mise.local.toml > default
# precedence on every mise release. Values must not contain spaces.
set -eu
cd "$(dirname "$0")/.."
vars=$(sed -n 's/^\([A-Z_][A-Z_0-9]*\) = .*/\1/p' mise.toml)
overrides=""
for v in $vars; do
  eval "val=\${$v-}"
  [ -n "$val" ] && overrides="$overrides $v=$val"
done
# shellcheck disable=SC2086
exec mise exec -- env $overrides "$@"
