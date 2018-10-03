import {CliCommand} from '../../types'
import cleanCluster from './cleanCluster'
import initCluster from './initCluster'
import restart from './restart'
import sync from './sync'

const commands: {[commandName: string]: CliCommand} = {
  'cluster:init': initCluster,
  'cluster:clean': cleanCluster,
  sync,
  restart,
}

export default commands
