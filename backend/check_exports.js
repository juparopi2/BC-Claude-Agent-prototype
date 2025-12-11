try {
  const azureOpenAI = require('@azure/openai');
  console.log('Exports from @azure/openai:');
  console.log(Object.keys(azureOpenAI));
} catch (error) {
  console.error('Error loading @azure/openai:', error);
}

try {
  const openai = require('openai');
  console.log('\nExports from openai:');
  console.log(Object.keys(openai));
} catch (error) {
  console.log('\nopenai package not found or error loading.');
}
