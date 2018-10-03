import {Core_v1Api} from '@kubernetes/client-node'
import {exec as execCb} from 'child_process'
import {randomBytes} from 'crypto'
import {accessSync, mkdir as mkdirCb, unlink as unlinkCb, writeFile} from 'fs'
import * as path from 'path'
import {promisify} from 'util'
import {Config, Syncer} from '../../lib'

const exec = promisify(execCb)
const mkdir = promisify(mkdirCb)
const unlink = promisify(unlinkCb)

class TestContext {
  public config: Config
  public contextId: string
  public syncer: Syncer
  public tempDir: string

  constructor() {
    this.contextId = randomBytes(8).toString('hex')
    this.tempDir = path.join(
      path.resolve(__dirname, '../'),
      'tmp',
      `test-${this.contextId}`
    )
    const {KUBE_NAMESPACE, KUBE_CONTEXT} = process.env

    if (!KUBE_NAMESPACE || !KUBE_CONTEXT) {
      throw new Error(
        'KUBE_NAMESPACE and KUBE_CONTEXT env vars must be defined'
      )
    }

    this.config = new Config(({
      kubeContext: KUBE_CONTEXT,
      namespace: KUBE_NAMESPACE,
      daemonSetNamespace: 'boilerplate',
      rootPath: path.join(this.tempDir, 'localFiles'),
      sync: {
        test: {
          containerPath: '/test',
          podSelector: {
            labelSelector: `contextId=${this.contextId}`,
          },
          excludeDirs: ['node_modules'],
        },
      },
    } as any) as Config)

    this.syncer = new Syncer(this.config)
  }

  public async initialize() {
    await mkdir(this.tempDir)
    await mkdir(path.join(this.tempDir, 'localFiles'))
    await mkdir(path.join(this.tempDir, 'downloadedRemoteFiles'))
    await this.createPod()
  }

  public async clean() {
    await this.syncer.stop()
    await this.destroyPod()
    await exec(`rm -rf ${this.tempDir}`)
  }

  public async putRemoteFiles(files: {[path: string]: string}) {
    //
  }

  public async putLocalFiles(files: {[relativePath: string]: string}) {
    for (const [relativePath, data] of Object.entries(files)) {
      const pathParts = relativePath.split('/')
      if (pathParts.length > 1) {
        for (let i = 1; i <= pathParts.length - 1; i++) {
          const dirPath = path.join(
            this.tempDir + '/localFiles',
            pathParts.slice(0, i).join('/')
          )
          try {
            accessSync(dirPath)
          } catch (error) {
            await mkdir(dirPath)
          }
        }
      }

      await new Promise((resolve, reject) => {
        writeFile(
          path.join(this.tempDir, '/localFiles', relativePath),
          data,
          err => (err ? reject(err) : resolve())
        )
      })
    }
  }

  public async localAndRemoteDiff() {
    const downloadId = randomBytes(8).toString('hex')

    const podName = `k8sync-test-${this.contextId}`
    const kubectlArgs = [
      `--namespace=${this.config.namespace}`,
      ...(this.config.kubeContext
        ? [`--context=${this.config.kubeContext}`]
        : []),
      'cp',
      `${podName}:/test`,
      path.join(this.tempDir, 'downloadedRemoteFiles', downloadId),
    ]
    await exec(`${this.config.kubectlPath} ${kubectlArgs.join(' ')}`)
    try {
      await exec(
        `diff -r ${path.join(this.tempDir, 'localFiles')} ${path.join(
          this.tempDir,
          'downloadedRemoteFiles',
          downloadId
        )}`
      )
      return null
    } catch (error) {
      return error.stdout.replace(new RegExp(this.tempDir, 'g'), '')
    }
  }

  public async deleteLocalFiles(paths: string[]) {
    for (const localPath of paths) {
      await unlink(path.join(this.tempDir, '/localFiles', localPath))
    }
  }
  public async moveLocalFiles(moves: {[currentPath: string]: string}) {
    for (const [currentPath, newPath] of Object.entries(moves)) {
      await exec(
        `mv ${path.join(this.tempDir, 'localFiles', currentPath)} ${path.join(
          this.tempDir,
          'localFiles',
          newPath
        )}`
      )
    }
  }

  get podSynced() {
    return new Promise((resolve, reject) => {
      this.syncer.once('syncCompleted', resolve)
    })
  }

  protected async createPod() {
    const pod = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: {
        name: `k8sync-test-${this.contextId}`,
        labels: {
          contextId: this.contextId,
        },
      },
      spec: {
        nodeSelector: {'beta.kubernetes.io/os': 'linux'},
        terminationGracePeriodSeconds: 0,
        containers: [
          {
            name: 'test',
            image: 'alpine',
            command: ['ash', '-c', 'sleep 600'],
            resources: {
              requests: {memory: '10Mi', cpu: '10m'},
              limits: {memory: '10Mi', cpu: '100m'},
            },
          },
        ],
      },
    }

    const cluster = this.config.kubeConfig.makeApiClient(Core_v1Api)

    await cluster.createNamespacedPod(this.config.namespace, pod as any)
  }

  protected async destroyPod() {
    const cluster = this.config.kubeConfig.makeApiClient(Core_v1Api)

    try {
      await cluster.deleteNamespacedPod(
        `k8sync-test-${this.contextId}`,
        this.config.namespace,
        {} as any
      )
    } catch (error) {
      if (!error.response || error.response.body.code !== 404) {
        throw error
      }
    }
  }
}

export default TestContext
