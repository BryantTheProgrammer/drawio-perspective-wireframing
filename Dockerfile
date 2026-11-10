FROM jgraph/drawio:latest

USER root

# Page Explorer plugin
COPY page-explorer.js /usr/local/tomcat/webapps/draw/plugins/page-explorer.js

# Custom shape libraries (served at /custom-libs/<file>.xml)
COPY libraries/ /usr/local/tomcat/webapps/draw/custom-libs/

# Auto-load the plugin for every user
COPY loader.js /tmp/pe-loader.js
RUN cat /tmp/pe-loader.js >> /usr/local/tomcat/webapps/draw/js/PostConfig.js \
 && rm /tmp/pe-loader.js \
 && rm -f /usr/local/tomcat/webapps/draw/custom-libs/README.txt \
 && chmod -R a+rX /usr/local/tomcat/webapps/draw/plugins /usr/local/tomcat/webapps/draw/custom-libs
