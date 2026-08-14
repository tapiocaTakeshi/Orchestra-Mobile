// Supabase (@supabase/supabase-js) が依存する Web API のポリフィル。
// registerRootComponent より前、他の何よりも先に読み込む必要がある。
import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';

import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);
