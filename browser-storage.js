// Denied browser storage must not stop the interface from starting.
export function safeStorage(name){
 const fallback=new Map();
 return {
  getItem(key){try{return globalThis[name].getItem(key)??fallback.get(key)??null;}catch{return fallback.get(key)??null;}},
  setItem(key,value){fallback.set(key,String(value));try{globalThis[name].setItem(key,value);}catch{}},
  removeItem(key){fallback.delete(key);try{globalThis[name].removeItem(key);}catch{}}
 };
}
