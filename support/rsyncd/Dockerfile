FROM alpine:latest

RUN \
  apk --no-cache add rsync \
  && mkdir -p /overlay2

COPY rsyncd.conf /etc/rsyncd.conf

EXPOSE 873

ENTRYPOINT [ \
  "/usr/bin/rsync", \
  "--daemon", \
  "--no-detach", \
  "--dparam=pidfile=/var/run/rsyncd.pid" \
]

HEALTHCHECK CMD /bin/ash -c "PID=\$(cat /var/run/rsyncd.pid) && [ -n \"\${PID}\" -a -d \"/proc/\${PID}\" ] && exit 0 || exit 1"