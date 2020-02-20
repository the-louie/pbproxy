# pbproxy
Simple url proxy with timespread features.

## Environment variables
Needed to get the ship to run

HOSTNAME (required) - Hostname of the target, i.e. 'imgur.com' (without https)
HOSTPORT - Port of target, default 443
HOSTPATH - Path of target, i.e. '/upload'
HOSTUSER - Basic auth username 
HOSTPASS - Basic auth password
LOCALPORT - Local port to listen on

## How to post
Send a get-request with the url-parameter url to /REG, i.e. http://localhost:9922/REG/?url=google.com
