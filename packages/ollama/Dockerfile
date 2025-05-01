# NOTE: This Dockerfile defines a *client* application (`app` service in the original, unused compose file)
#       that was intended to interact with the Ollama service.
#       It is **NOT** used to build the Ollama service itself (which uses the official ollama/ollama image).
#       This client is currently **DEPRECATED** and **UNUSED** by the main Therascript application.
#       The core interaction logic is handled by `packages/api`.

# Use an official Node.js runtime as a parent image (Alpine for smaller size)
FROM node:20-alpine

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (if available) first to leverage Docker cache
COPY package*.json ./

# Install app dependencies - only production dependencies needed for the final image
# If build steps were needed, you might install devDependencies temporarily
RUN npm install --only=production

# Bundle app source code into the container
COPY . .

# --- Build Step ---
# If this package involved TypeScript compilation (it does):
# 1. Temporarily install devDependencies needed for building
# 2. Run the build script defined in package.json
# 3. Prune devDependencies afterwards to keep the image lean
RUN npm install --only=development
RUN npm run build
RUN npm prune --production
# --- End Build Step ---

# Define environment variables (these can be overridden by docker-compose or `docker run -e`)
ENV NODE_ENV=production
# This client expected to talk to the 'ollama' service on the Docker network
ENV OLLAMA_BASE_URL=http://ollama:11434

# Make port 3000 available (if this client were a server itself, which it isn't currently)
# EXPOSE 3000

# Define the command to run the application (executes the compiled JavaScript)
# Assumes the main entry point after build is dist/index.js
CMD ["node", "dist/index.js"]
