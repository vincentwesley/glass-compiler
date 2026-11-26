import '@glass/ui/fonts';
import '@glass/ui/styles/tokens.css';
import '@glass/ui/styles/base.css';
import '@glass/ui/styles/components.css';
import '@glass/ui/styles/credits.css';
import './hub.css';
import '@glass/ui/brand/logo.css';
import '@glass/ui/brand/logo-resize';
import '@glass/ui/credits';
import { byId } from '@glass/ui/dom';
import { mountThemeToggle } from '@glass/ui/theme';

document.documentElement.classList.add('js');
mountThemeToggle(byId<HTMLButtonElement>('theme-toggle'));
