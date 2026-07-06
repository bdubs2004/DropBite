import { DEMO_MODE } from '../config';
import { MockService } from './mock/mockService';
import { DataService } from './types';

let service: DataService | null = null;

export function getDataService(): DataService {
  if (!service) {
    if (DEMO_MODE) {
      service = new MockService();
    } else {
      // Lazy require so the Supabase client is only constructed when configured.
      const { SupabaseService } = require('./supabase/supabaseService');
      service = new SupabaseService();
    }
  }
  return service!;
}
