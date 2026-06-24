import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useGetPreferencesQuery, useTogglePreferenceMutation } from './chatApi';
import type { Property } from './types';
import { generateUUID } from '../../utils/uuid';

interface PreferencesContextType {
  shortlistedProperties: string[];
  notInterestedProperties: string[];
  knownProperties: Record<string, Property>;
  registerProperties: (properties: Property[]) => void;
  togglePreference: (propertyId: string, action: 'shortlist' | 'remove_shortlist' | 'not_interested' | 'remove_not_interested') => Promise<void>;
  updateFromVoice: (shortlist: string[], notInterested: string[]) => void;
  isDrawerOpen: boolean;
  setIsDrawerOpen: (isOpen: boolean) => void;
  sessionId: string;
  startNewSession: () => void;
}

const PreferencesContext = createContext<PreferencesContextType | undefined>(undefined);

export const PreferencesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [sessionId, setSessionId] = useState(() => localStorage.getItem('chatSessionId') || generateUUID());
  
  useEffect(() => {
    localStorage.setItem('chatSessionId', sessionId);
  }, [sessionId]);

  const [shortlisted, setShortlisted] = useState<string[]>([]);
  const [notInterested, setNotInterested] = useState<string[]>([]);
  const [knownProperties, setKnownProperties] = useState<Record<string, Property>>({});
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const startNewSession = useCallback(() => {
    setSessionId(generateUUID());
    setShortlisted([]);
    setNotInterested([]);
    setKnownProperties({});
  }, []);

  useEffect(() => {
    const handleNewChat = () => {
      startNewSession();
    };
    window.addEventListener('chatbot:new-chat', handleNewChat);
    return () => window.removeEventListener('chatbot:new-chat', handleNewChat);
  }, [startNewSession]);

  const { data } = useGetPreferencesQuery(sessionId, { skip: !sessionId });
  const [togglePreferenceMutation] = useTogglePreferenceMutation();

  const registerProperties = useCallback((properties: Property[]) => {
    setKnownProperties(prev => {
      const next = { ...prev };
      let changed = false;
      for (const p of properties) {
        if (!next[p.id]) {
          next[p.id] = p;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  useEffect(() => {
    if (data?.success) {
      setShortlisted(data.shortlistedProperties || []);
      setNotInterested(data.notInterestedProperties || []);
      if (data.properties && data.properties.length > 0) {
        registerProperties(data.properties);
      }
    }
  }, [data, registerProperties]);

  const togglePreference = useCallback(async (propertyId: string, action: 'shortlist' | 'remove_shortlist' | 'not_interested' | 'remove_not_interested') => {
    // Optimistic UI update
    let previousShortlist = [...shortlisted];
    let previousNotInterested = [...notInterested];
    
    let nextShortlist = new Set(shortlisted);
    let nextNotInterested = new Set(notInterested);
    
    if (action === 'shortlist') {
      nextShortlist.add(propertyId);
      nextNotInterested.delete(propertyId);
    } else if (action === 'remove_shortlist') {
      nextShortlist.delete(propertyId);
    } else if (action === 'not_interested') {
      nextNotInterested.add(propertyId);
      nextShortlist.delete(propertyId);
    } else if (action === 'remove_not_interested') {
      nextNotInterested.delete(propertyId);
    }
    
    setShortlisted(Array.from(nextShortlist));
    setNotInterested(Array.from(nextNotInterested));

    try {
      const response = await togglePreferenceMutation({ sessionId, propertyId, action }).unwrap();
      if (response.success) {
        setShortlisted(response.shortlistedProperties);
        setNotInterested(response.notInterestedProperties);
        if (response.properties && response.properties.length > 0) {
          registerProperties(response.properties);
        }
      }
    } catch (error) {
      console.error("Failed to toggle preference:", error);
      // Revert optimistic update
      setShortlisted(previousShortlist);
      setNotInterested(previousNotInterested);
    }
  }, [sessionId, shortlisted, notInterested, togglePreferenceMutation]);

  const updateFromVoice = useCallback((shortlist: string[], notInterested: string[]) => {
    setShortlisted(shortlist);
    setNotInterested(notInterested);
  }, []);

  return (
    <PreferencesContext.Provider value={{
      shortlistedProperties: shortlisted,
      notInterestedProperties: notInterested,
      knownProperties,
      registerProperties,
      togglePreference,
      updateFromVoice,
      isDrawerOpen,
      setIsDrawerOpen,
      sessionId,
      startNewSession
    }}>
      {children}
    </PreferencesContext.Provider>
  );
};

export const usePreferences = () => {
  const context = useContext(PreferencesContext);
  if (context === undefined) {
    throw new Error('usePreferences must be used within a PreferencesProvider');
  }
  return context;
};
