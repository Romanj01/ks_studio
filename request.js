export async function requestJson(url, options = {}, timeoutMs = 12000) {
  const mode=globalThis.document?.body?.dataset;
  if(mode?.demo==='1'&&mode.demoStorage!=='server'){const {demoRequest}=await import('./autonomous-demo.js');return demoRequest(url,options);}
  const controller = new AbortController();
  const callerSignal = options.signal;
  const cancel = () => controller.abort();
  if (callerSignal?.aborted) cancel();
  else callerSignal?.addEventListener('abort', cancel, {once:true});
  let expired = false;
  const timer = setTimeout(() => { expired = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetch(url, {...options, signal: controller.signal});
    let data;
    try { data = await response.json(); }
    catch (error) {
      if (controller.signal.aborted) throw error;
      const invalid = new Error('Сервер вернул некорректный ответ. Попробуйте ещё раз.');
      invalid.status = response.status;
      throw invalid;
    }
    if (!response.ok) {
      const error = new Error(data.error || 'Не удалось выполнить запрос');
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (callerSignal?.aborted) throw new DOMException('Запрос отменён', 'AbortError');
    if (expired) {
      throw new Error(options.method && options.method !== 'GET'
        ? 'Сервер не ответил вовремя. Перед повторной отправкой проверьте, сохранились ли изменения.'
        : 'Сервер не ответил вовремя. Попробуйте ещё раз.');
    }
    if (error instanceof TypeError) throw new Error('Не удалось связаться с салоном. Проверьте подключение и попробуйте ещё раз.');
    throw error;
  } finally { clearTimeout(timer); callerSignal?.removeEventListener('abort', cancel); }
}
