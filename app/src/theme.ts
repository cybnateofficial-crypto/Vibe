import { Platform } from 'react-native';

export const theme = {
  bg: '#0B0D12',
  card: '#141926',
  card2: '#1B2233',
  border: '#232B3E',
  text: '#EAEEF7',
  sub: '#8B93A7',
  accent: '#7C5CFF',
  accentSoft: '#241E4E',
  green: '#3DDC97',
  red: '#FF6B6B',
  amber: '#FFC857',
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
};
