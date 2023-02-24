FROM node:latest

RUN mkdir /app
WORKDIR /app
RUN mkdir ./data

RUN apt-get update && apt-get -y autoremove && apt-get -y upgrade

RUN apt-get -y install build-essential python sqlite3
RUN apt-get -y install python-is-python3

# Install all npm packages
RUN npm install -g npm

# Install app dependencies
COPY package.json ./
RUN npm install

COPY index.js ./

EXPOSE 19922

CMD [ "node", "index.js" ]