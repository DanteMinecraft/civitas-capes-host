FROM nginx:alpine
COPY index.html /usr/share/nginx/html/index.html
COPY capes.json /usr/share/nginx/html/capes.json
COPY players.json /usr/share/nginx/html/players.json
COPY capes/ /usr/share/nginx/html/capes/
EXPOSE 80
