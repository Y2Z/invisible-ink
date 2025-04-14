FROM ubuntu:24.04

RUN apt-get update && apt-get install -y \
    make \
    nodejs \
    npm

# Install packages into ./../node_modules
WORKDIR /src/y2z/invisible-ink/..
ADD Prebuild.mk package.json package-lock.json ./
RUN make -f Prebuild.mk INSTALL_DEPS

WORKDIR /src/y2z/invisible-ink

CMD ["make", "SERVE"]
