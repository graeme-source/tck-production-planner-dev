# Recovery image: official Postgres 18 (matches the corrupt data's major
# version exactly) + pg_filedump as a fallback if standard tools can't
# read the cluster. Runs a script that tries the cheap fixes first
# (start as-is, then pg_resetwal) and only escalates to forensic tools
# if those fail.
FROM postgres:18-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        postgresql-18-pg-filedump \
        less \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY recover.sh /usr/local/bin/recover.sh
RUN chmod +x /usr/local/bin/recover.sh

# Drop the default postgres entrypoint — we manage startup ourselves so
# the failure modes are visible in Railway's deployment logs.
ENTRYPOINT []
CMD ["/usr/local/bin/recover.sh"]
