// tslint:disable:no-var-requires

import chalk from 'chalk'
import {CliCommand} from '../types'

const columnify = require('columnify')

export async function showCommandHelp(name: string, command: CliCommand) {
  const cmdComponents = [
    chalk.greenBright.bold('$'),
    chalk.bold.blue('k8sync'),
    chalk.yellow(name),
  ]

  if (command.params) {
    cmdComponents.push(chalk.white('[--param value]'))
  }

  if (command.args) {
    cmdComponents.push(chalk.white(command.args))
  }

  console.log('\n' + cmdComponents.join(' ') + '\n')

  console.log(command.description)
  console.log('')

  if (command.help) {
    console.log(command.help)
    console.log('')
  }

  if (command.params) {
    showTable(command.params, 'parameter', 'description')
  }
}

export async function showCommands(
  commands: {
    [commandName: string]: CliCommand
  },
  globalParams: {[paramName: string]: string}
) {
  const cmdComponents = [
    chalk.greenBright.bold('$'),
    chalk.bold.blue('k8sync'),
    chalk.white('[--param value]'),
    chalk.yellow('<command>'),
    chalk.white('[arg …]'),
  ]

  console.log('\n' + cmdComponents.join(' ') + '\n')

  if (Object.keys(commands).length) {
    const commandTable = columnify(
      Object.keys(commands)
        .sort()
        .map(commandName => ({
          Command: chalk.blueBright(commandName),
          Description: commands[commandName].description,
        })),
      {
        headingTransform(heading: string) {
          return chalk.red(heading)
        },
        columnSplitter: '   ',
      }
    )

    console.log(`${commandTable}\n`)

    showTable(globalParams, 'Parameter', 'Description')

    console.log('Run "k8sync <command> --help" for command details')
  }
}

export async function showTable(
  data: {[commandName: string]: string},
  keyHeader: string,
  valueHeader: string
) {
  const table = columnify(
    Object.keys(data)
      .sort()
      .map(paramName => ({
        [keyHeader]: chalk.blueBright(paramName),
        [valueHeader]: data[paramName],
      })),
    {
      headingTransform(heading: string) {
        return chalk.red(heading)
      },
      columnSplitter: '   ',
    }
  )

  console.log(table)
  console.log('')
}
