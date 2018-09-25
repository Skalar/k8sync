const http = require('http')
const {DOCKER_SOCKET_PATH = '/var/run/docker.sock'} = process.env

function getContainerFsPath(request, response) {
  const containerId = request.url.substr(1)
  const dockerRequest = http
    .request(
      {
        socketPath: DOCKER_SOCKET_PATH,
        path: `/containers/${containerId}/json`,
      },
      res => {
        const {statusCode} = res
        const contentType = res.headers['content-type']

        if (statusCode === 200) {
          res.setEncoding('utf8')
          let rawData = ''
          res.on('data', chunk => (rawData += chunk))
          res.on('end', () => {
            try {
              const {
                GraphDriver: {
                  Data: {MergedDir: path},
                },
              } = JSON.parse(rawData)
              response.end(path)
            } catch (e) {
              response.statusCode = 500
              response.end(e.message)
              console.error(e.message)
            }
          })
        } else if (statusCode === 404) {
          response.statusCode = 404
          response.end()
          return
        } else {
          errorMessage = `Docker API request failed (${statusCode})`
          console.error(errorMessage)
          response.statusCode = 500
          response.end(errorMessage)
          return
        }
      }
    )
    .on('error', e => {
      console.error(e)
      response.statusCode = 500
      response.end(e.toString())
    })

  dockerRequest.end()
}

module.exports = getContainerFsPath
