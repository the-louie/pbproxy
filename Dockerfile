FROM node:latest

WORKDIR /usr/src/app

VOLUME /usr/src/app/data

RUN apt-get update && apt-get -y autoremove && apt-get -y upgrade

RUN apt-get -y install build-essential python sqlite3

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./
COPY index.js ./

RUN npm install

EXPOSE 19922

CMD [ "node", "index.js" ]