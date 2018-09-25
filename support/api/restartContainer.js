const http = require('http')
const {DOCKER_SOCKET_PATH = '/var/run/docker.sock'} = process.env

function restartContainer(request, response) {
  const containerId = request.url.substr(1)
  const dockerRequest = http
    .request(
      {
        socketPath: DOCKER_SOCKET_PATH,
        path: `/containers/${containerId}/restart`,
        method: 'POST',
      },
      res => {
        const {statusCode} = res
        response.statusCode = res.statusCode
        res.pipe(response)
      }
    )
    .on('error', e => {
      console.error(e)
      response.statusCode = 500
      response.end(e.toString())
    })

  dockerRequest.end()
}

module.exports = restartContainer
