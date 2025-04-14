# Use an official Node.js runtime as a parent image
FROM node:20-alpine

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install app dependencies
RUN npm install --only=production # Install only production dependencies

# Bundle app source code
COPY . .

# Compile TypeScript to JavaScript
RUN npm install --only=development # Temporarily install dev deps for build
RUN npm run build
RUN npm prune --production # Remove dev dependencies after build

# Define environment variables (can be overridden by docker-compose)
ENV NODE_ENV=production
ENV OLLAMA_BASE_URL=http://ollama:11434

# Make port 3000 available to the world outside this container (if needed for other things)
# EXPOSE 3000

# Define the command to run the application
CMD ["node", "dist/index.js"]
