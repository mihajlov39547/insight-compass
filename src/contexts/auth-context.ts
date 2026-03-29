import { createContext } from 'react';
import type { AuthContextType } from '@/contexts/AuthContext';

export const AuthContext = createContext<AuthContextType | undefined>(undefined);
