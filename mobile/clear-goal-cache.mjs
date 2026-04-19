// Script to clear cached goal words from local AsyncStorage
// Run this in the mobile app console or use React Native Debugger

console.log('To clear old goal cache, run this in your app:');
console.log('');
console.log('// In mobile app (add to a debug button or run in console):');
console.log('import AsyncStorage from "@react-native-async-storage/async-storage";');
console.log('');
console.log('async function clearGoalCache() {');
console.log('  const keys = await AsyncStorage.getAllKeys();');
console.log('  const goalKeys = keys.filter(k => k.startsWith("wc_goal_"));');
console.log('  await AsyncStorage.multiRemove(goalKeys);');
console.log('  console.log(`Cleared ${goalKeys.length} cached goals`);');
console.log('}');
console.log('');
console.log('clearGoalCache();');

