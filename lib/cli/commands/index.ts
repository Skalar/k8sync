import {CliCommand} from '../../types'
import sync from './sync'
import restart from './restart'
import initCluster from './initCluster'
import cleanCluster from './cleanCluster'

const commands: {[commandName: string]: CliCommand} = {
  'cluster:init': initCluster,
  'cluster:clean': cleanCluster,
  sync,
  restart,
}

export default commands
