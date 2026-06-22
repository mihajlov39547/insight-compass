import React, { createContext, useContext, useMemo, useState } from 'react';

export interface BridgeMessage {
  id: string;
  role: string;
  content: string;
}

interface BridgeData {
  mode: 'project' | 'notebook';
  messages: BridgeMessage[];
  scrollContainerRef: React.RefObject<HTMLDivElement>;
}

interface ChatSearchBridgeValue {
  data: BridgeData | null;
  setData: (data: BridgeData | null) => void;
}

const Ctx = createContext<ChatSearchBridgeValue | null>(null);

export function ChatSearchBridgeProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<BridgeData | null>(null);
  const value = useMemo(() => ({ data, setData }), [data]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChatSearchBridge(): ChatSearchBridgeValue {
  const v = useContext(Ctx);
  if (!v) return { data: null, setData: () => {} };
  return v;
}
