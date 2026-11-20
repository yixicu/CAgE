import { registerHooks } from 'node:module';

// Pi 1.2 loads the loopback page lazily and offers no template option.
// Redirect only the presentation import shared by its two callback handlers.
const sdkEntry = import.meta.resolve('@earendil-works/pi-ai');
const handlers = new Set(['callback-server.js', 'openai-chatgpt.js'].map(
  name => new URL(`auth/oauth/${name}`, sdkEntry).href,
));
const page = new URL('./oauth-page.js', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '../../utils/oauth-page.js' && context.parentURL && handlers.has(context.parentURL)) {
      return { url: page, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
