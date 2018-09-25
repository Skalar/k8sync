import * as parseArgs from 'minimist'
import {showCommands, showCommandHelp} from './utils'
import commands from './commands'
import Config from '../Config'
import {resolve} from 'path'

const globalParams = {
  '--config': 'Path to config file',
}

export default async function cli() {
  const {_: args, ...params} = parseArgs(process.argv.slice(2))
  const commandName = args.shift()

  if (!commandName) {
    showCommands(commands, globalParams)
    return
  }

  const command = commands[commandName]

  if (!command) {
    showCommands(commands, globalParams)
    return
  }

  if (params.help) {
    showCommandHelp(commandName, command)
    return
  }

  const config = await Config.load(
    params.config ? resolve(process.cwd(), params.config) : undefined
  )

  if (!config) {
    console.log(
      'No config file found. Create a k8sync.yaml file in your project root.'
    )

    return
  }

  await command.handler(config, args, params)
}
