// Must be first: installs crypto.getRandomValues for @noble on Hermes.
import './src/core/random';
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
