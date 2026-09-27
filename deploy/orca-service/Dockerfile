# Headless Orca runtime (`orca serve`) for Railway. Pair a desktop Orca to it to watch and drive it.
# libasound2t64: Orca links ALSA but its .deb does not declare it.
FROM debian:trixie-slim

ARG ORCA_VERSION=1.4.215
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git xvfb xauth libasound2t64 \
  && curl -fsSL -o /tmp/orca.deb "https://github.com/stablyai/orca/releases/download/v${ORCA_VERSION}/orca-ide_${ORCA_VERSION}_amd64.deb" \
  && apt-get install -y --no-install-recommends /tmp/orca.deb \
  && rm -rf /tmp/orca.deb /var/lib/apt/lists/*

# Electron refuses to run its sandbox as root; run as a normal user whose home is the volume.
RUN useradd --create-home --home-dir /data --shell /bin/bash orca
# Railway containers have no user namespaces, so Chromium's sandbox can't start.
ENV HOME=/data \
    ORCA_USER_DATA_PATH=/data/orca-runtime \
    ELECTRON_DISABLE_SANDBOX=1

COPY --chmod=755 start.sh /usr/local/bin/start-orca
# Starts as root only to take ownership of the (root-owned) Railway volume, then drops to `orca`.
WORKDIR /data
CMD ["start-orca"]
