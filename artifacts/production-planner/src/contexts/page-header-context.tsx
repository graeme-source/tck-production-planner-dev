import { useLayoutEffect, useSyncExternalStore, type ReactNode } from "react";

interface PageHeaderData {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}

let _header: PageHeaderData | null = null;
const _listeners = new Set<() => void>();

function _subscribe(cb: () => void) {
  _listeners.add(cb);
  return () => { _listeners.delete(cb); };
}

function _getSnapshot() {
  return _header;
}

export function setPageHeader(data: PageHeaderData | null) {
  _header = data;
  _listeners.forEach(l => l());
}

export function usePageHeaderValue(): PageHeaderData | null {
  return useSyncExternalStore(_subscribe, _getSnapshot);
}

export function useSetPageHeader(title: string, description?: ReactNode, action?: ReactNode) {
  useLayoutEffect(() => {
    setPageHeader({ title, description, action });
    return () => {
      if (_header?.title === title) setPageHeader(null);
    };
  }, [title, description, action]);
}
