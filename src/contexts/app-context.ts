import { createContext } from 'react';
import type { AppContextType } from '@/contexts/AppContext';

export const AppContext = createContext<AppContextType | undefined>(undefined);
