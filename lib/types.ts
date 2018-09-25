import {ChildProcess} from 'child_process'
import Config from './Config'

export interface SyncSpecification {
  localPath: string
  containerPath: string
  selectors: [string]
  watchmanExpression?: [string, ...any[]]
  podSelector:
    | {labelSelector: string}
    | {fieldSelector: string}
    | {labelSelector: string; fieldSelector: string}
  excludeDirs: string[]
  restartAfterInitialSync?: boolean
  restartAfterSync?: boolean
}

export interface CliCommand {
  description: string
  args?: string
  help?: string
  params?: {[paramName: string]: string}

  handler(config: Config, args: string[], params: object): Promise<void>
}

export interface WatchmanSubscriptionResponse {
  root: string
  subscription: string
  files: WatchmanSubscriptionResponseFile[]
}

export interface WatchmanSubscriptionResponseFile {
  exists: boolean
  name: string
  size: number
  type: string
}

export interface TargetPod {
  name: string
  containerFsPath: string
  nodeName: string
  sync: SyncSpecification
  containerId: string
}

export interface DaemonSetPodTunnel {
  nodeName: string
  podName: string
  rsyncPort: number
  apiPort: number
  process: ChildProcess
}
