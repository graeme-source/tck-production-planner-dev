# Recovery image: official Postgres 18 (matches the corrupt data's major
# version exactly). Built-in tools — pg_ctl, postgres, pg_resetwal,
# pg_dumpall, pg_controldata — handle the cases we expect. pg_filedump
# would be a last-resort forensic tool, but its apt package isn't
# available for PG18 on bookworm yet, so we skip it. If we need it
# later we'll build from source in a follow-up image.
FROM postgres:18-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        less \
        ca-certificates \
        curl \
        wget \
        python3 \
    && rm -rf /var/lib/apt/lists/*

COPY recover.sh /usr/local/bin/recover.sh
RUN chmod +x /usr/local/bin/recover.sh

# Drop the default postgres entrypoint — we manage startup ourselves so
# the failure modes are visible in Railway's deployment logs.
ENTRYPOINT []
CMD ["/usr/local/bin/recover.sh"]
