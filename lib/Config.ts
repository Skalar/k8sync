import {KubeConfig} from '@kubernetes/client-node'
import * as fs from 'fs'
import * as yaml from 'js-yaml'
import {dirname, sep} from 'path'
import {promisify} from 'util'
import {SyncSpecification} from './types'

const readFile = promisify(fs.readFile)
const access = promisify(fs.access)

class Config {
  /**
   * Load k8sync config file
   */
  public static async load(path?: string) {
    const pathToUse = path || (await this.findConfigFilePath())

    if (!pathToUse) {
      return null
    }
    let configString = (await readFile(pathToUse)).toString('utf-8')
    const varsToReplace = configString.match(/\$\{([^\}]+)\}/gm)

    if (varsToReplace) {
      configString = varsToReplace.reduce((result, varStr) => {
        const strMatch = varStr.match(/^\$\{([^\}\:]+)(?:\:\-)?([^\}]+)?\}$/)
        if (strMatch) {
          const [, name, defaultValue] = strMatch
          return result.replace(varStr, process.env[name] || defaultValue)
        }

        return ''
      }, configString)
    }
    const data = yaml.safeLoad(configString)

    return new Config({rootPath: dirname(pathToUse), ...data})
  }

  /**
   * Walk up directory tree to find k8sync config file
   */
  protected static async findConfigFilePath() {
    const pathParts = process.cwd().split(sep)
    while (pathParts.length) {
      const path = pathParts.join(sep) + '/k8sync.yaml'

      try {
        await access(path)
        return path
      } catch (error) {
        pathParts.pop()
      }
    }
  }
  /**
   * Kubernetes namespace to install k8sync DaemonSet
   */
  public daemonSetNamespace: string = 'kube-system'

  /**
   * Default namespace for pods to sync
   */
  public namespace: string

  /**
   * Project root, all specifications are relative to this.
   * Defaults to the dir in which the config resides.
   */
  public rootPath: string

  /**
   * Specifications for what to sync
   */
  public sync: {[name: string]: SyncSpecification} = {}

  /**
   * Which kubernetes config context to use
   */
  public kubeContext?: string

  /**
   * Path to rsync executable
   */
  public rsyncPath: string = 'rsync'

  /**
   * Path to kubectl executable
   */
  public kubectlPath: string = 'kubectl'

  /**
   * Max number of files before forcing full sync
   */
  public maxFilesForPartialSync: number = 500

  /**
   * Path to docker overlay2 fs on kubernetes nodes
   */
  public nodeOverlay2Path = '/var/lib/docker/overlay2'

  /**
   * Path to docker socket on kubernetes nodes
   */
  public nodeDockerSocketPath = '/var/run/docker.sock'

  /**
   * Config for node kubernetes client
   */
  public kubeConfig: KubeConfig

  constructor(input: Config) {
    this.namespace = input.namespace
    this.rootPath = input.rootPath
    this.sync = input.sync

    if (input.daemonSetNamespace) {
      this.daemonSetNamespace = input.daemonSetNamespace
    }

    if (input.rsyncPath) {
      this.rsyncPath = input.rsyncPath
    }

    this.kubeConfig = new KubeConfig()
    this.kubeConfig.loadFromDefault()

    if (input.kubeContext) {
      this.kubeContext = input.kubeContext
      this.kubeConfig.setCurrentContext(this.kubeContext)
    }
  }
}

export default Config
