import {Core_v1Api, V1Pod} from '@kubernetes/client-node'
import {tick} from 'figures'
import * as request from 'request'
import NodeTunneler from '../../NodeTunneler'
import {CliCommand} from '../../types'

const restart: CliCommand = {
  description: 'Restart containers while retaining synced files',
  args: '[name …]',

  async handler(config, args, params) {
    const specNames = args.length ? args : Object.keys(config.sync)

    console.log(`Restarting ${specNames.join(', ')}`)
    const tunneler = new NodeTunneler(config)
    await tunneler.start()

    const restartPromises = []

    for (const specName of specNames) {
      const spec = config.sync[specName]

      if (!spec) {
        throw new Error(`Unknown spec ${specName}`)
      }

      const cluster = config.kubeConfig.makeApiClient(Core_v1Api)
      const {
        body: {items: pods},
      } = await cluster.listNamespacedPod(
        config.namespace,
        undefined, // pretty
        undefined, // _continue
        ...('fieldSelector' in spec.podSelector
          ? [spec.podSelector.fieldSelector]
          : [undefined]),
        undefined, // includeUninitialized
        ...('labelSelector' in spec.podSelector
          ? [spec.podSelector.labelSelector]
          : [undefined])
      )

      const restartContainer = async (pod: V1Pod) => {
        const {nodeName} = pod.spec
        const containerStatus =
          pod.status.containerStatuses.find(container =>
            spec.containerName
              ? container.name === spec.containerName
              : container.name === specName
          ) || pod.status.containerStatuses[0]

        const containerId = containerStatus.containerID.substr(9)

        const tunnel = await tunneler.request(nodeName)

        await new Promise((resolve, reject) => {
          request.delete(
            `http://localhost:${tunnel.apiPort}/${containerId}`,
            (error, response, body) => {
              if (error) {
                console.error(
                  `${specName}: ${pod.metadata.name}/${containerId}: ${error}`
                )
                reject(error)
              } else {
                console.log(`${tick} ${specName}`)
                resolve(body)
              }
            }
          )
        })
      }

      for (const pod of pods) {
        if (pod.status.phase !== 'Running') continue

        restartPromises.push(restartContainer(pod))
      }
    }

    try {
      await Promise.all(restartPromises)
    } catch (error) {
      //
    }

    await tunneler.stop()
  },
}

export default restart
