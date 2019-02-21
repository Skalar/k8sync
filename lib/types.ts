import {ChildProcess} from 'child_process'
import Config from './Config'
import Sync from './Sync'

export interface SyncSpecification {
  localPath: string
  containerPath: string
  containerName?: string
  selectors: [string]
  watchmanExpression?: [string, ...any[]]
  podSelector:
    | {labelSelector: string}
    | {fieldSelector: string}
    | {labelSelector: string; fieldSelector: string}
  excludeDirs: string[]
  restartAfterInitialSync?: boolean
  restartAfterSync?: boolean
  rsyncArgs?: string[]
}

export interface TargetPod {
  targetName: string
  podName: string
  containerFsPath?: string
  nodeName: string
  syncSpec: SyncSpecification
  hasBeenSynced: boolean
  containerId: string
  containerName: string
  containerGuessed: boolean
  activeSync?: Sync
  pendingSync?: Sync
  previousSync?: Sync
}

export interface NodeTunnel {
  nodeName: string
  podName: string
  rsyncPort: number
  apiPort: number
  process: ChildProcess
}

export enum NodeTunnelerState {
  Stopped,
  Starting,
  Running,
  Stopping,
}

export enum SyncerState {
  Stopped,
  Starting,
  Running,
  Stopping,
}

export interface SyncerEvents {
  starting: void
  running: void
  stopping: void
  stopped: void
  error: (error: Error) => void
  podAdded: (targetPod: TargetPod) => void
  podDeleted: (targetPod: TargetPod) => void
  podWarning: (targetPod: TargetPod) => void
  syncStarted: (sync: Sync) => void
  syncCompleted: (sync: Sync) => void
  syncError: (error: Error, sync: Sync) => void
}

export enum SyncType {
  Full,
  Partial,
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
