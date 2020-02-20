FROM node:latest

WORKDIR /usr/src/app

VOLUME /usr/src/app/data

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./


RUN npm install

COPY . .

EXPOSE 19922

CMD [ "node", "index.js" ]