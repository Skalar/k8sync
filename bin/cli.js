#!/usr/bin/env node

const cli = require('../lib/cli').default

if (require.main === module) {
  process.on('unhandledRejection', e => {
    throw e
  })

  cli()
}
