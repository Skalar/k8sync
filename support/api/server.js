const http = require('http')
const getContainerFsPath = require('./getContainerFsPath')
const restartContainer = require('./restartContainer')

const {PORT = 80} = process.env

const server = http.createServer((request, response) => {
  switch (request.method) {
    case 'GET': {
      getContainerFsPath(request, response)
      return
    }
    case 'DELETE': {
      restartContainer(request, response)
      return
    }
    default: {
      response.statusCode = 404
      response.end()
    }
  }
})

server.listen(PORT, err => {
  if (err) {
    throw err
  }

  console.log(`k8sync container-path-server is listening on ${PORT}`)
})
