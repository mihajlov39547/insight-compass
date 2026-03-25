export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      chats: {
        Row: {
          created_at: string
          id: string
          is_archived: boolean
          language: string
          name: string
          project_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_archived?: boolean
          language?: string
          name: string
          project_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_archived?: boolean
          language?: string
          name?: string
          project_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chats_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      document_analysis: {
        Row: {
          created_at: string
          document_id: string
          extracted_text: string | null
          id: string
          indexed_at: string | null
          metadata_json: Json | null
          normalized_search_text: string | null
          ocr_used: boolean | null
          search_vector: unknown
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          document_id: string
          extracted_text?: string | null
          id?: string
          indexed_at?: string | null
          metadata_json?: Json | null
          normalized_search_text?: string | null
          ocr_used?: boolean | null
          search_vector?: unknown
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          document_id?: string
          extracted_text?: string | null
          id?: string
          indexed_at?: string | null
          metadata_json?: Json | null
          normalized_search_text?: string | null
          ocr_used?: boolean | null
          search_vector?: unknown
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_analysis_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: true
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      document_chunks: {
        Row: {
          chat_id: string | null
          chunk_index: number
          chunk_text: string
          created_at: string
          document_id: string
          embedding: string | null
          id: string
          language: string | null
          metadata_json: Json | null
          notebook_id: string | null
          page: number | null
          project_id: string | null
          section: string | null
          token_count: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          chat_id?: string | null
          chunk_index: number
          chunk_text: string
          created_at?: string
          document_id: string
          embedding?: string | null
          id?: string
          language?: string | null
          metadata_json?: Json | null
          notebook_id?: string | null
          page?: number | null
          project_id?: string | null
          section?: string | null
          token_count?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          chat_id?: string | null
          chunk_index?: number
          chunk_text?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          id?: string
          language?: string | null
          metadata_json?: Json | null
          notebook_id?: string | null
          page?: number | null
          project_id?: string | null
          section?: string | null
          token_count?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_chunks_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_chunks_notebook_id_fkey"
            columns: ["notebook_id"]
            isOneToOne: false
            referencedRelation: "notebooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_chunks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          char_count: number | null
          chat_id: string | null
          created_at: string
          detected_language: string | null
          file_name: string
          file_size: number
          file_type: string
          id: string
          last_retry_at: string | null
          mime_type: string
          notebook_enabled: boolean
          notebook_id: string | null
          page_count: number | null
          processing_error: string | null
          processing_status: string
          project_id: string | null
          retry_count: number
          storage_path: string
          summary: string | null
          user_id: string
          word_count: number | null
        }
        Insert: {
          char_count?: number | null
          chat_id?: string | null
          created_at?: string
          detected_language?: string | null
          file_name: string
          file_size: number
          file_type: string
          id?: string
          last_retry_at?: string | null
          mime_type: string
          notebook_enabled?: boolean
          notebook_id?: string | null
          page_count?: number | null
          processing_error?: string | null
          processing_status?: string
          project_id?: string | null
          retry_count?: number
          storage_path: string
          summary?: string | null
          user_id: string
          word_count?: number | null
        }
        Update: {
          char_count?: number | null
          chat_id?: string | null
          created_at?: string
          detected_language?: string | null
          file_name?: string
          file_size?: number
          file_type?: string
          id?: string
          last_retry_at?: string | null
          mime_type?: string
          notebook_enabled?: boolean
          notebook_id?: string | null
          page_count?: number | null
          processing_error?: string | null
          processing_status?: string
          project_id?: string | null
          retry_count?: number
          storage_path?: string
          summary?: string | null
          user_id?: string
          word_count?: number | null
        }
        Relationships: []
      }
      messages: {
        Row: {
          chat_id: string
          content: string
          created_at: string
          id: string
          model_id: string | null
          role: string
          sources: Json | null
          user_id: string
        }
        Insert: {
          chat_id: string
          content: string
          created_at?: string
          id?: string
          model_id?: string | null
          role: string
          sources?: Json | null
          user_id: string
        }
        Update: {
          chat_id?: string
          content?: string
          created_at?: string
          id?: string
          model_id?: string | null
          role?: string
          sources?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
        ]
      }
      notebook_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          model_id: string | null
          notebook_id: string
          role: string
          sources: Json | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          model_id?: string | null
          notebook_id: string
          role: string
          sources?: Json | null
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          model_id?: string | null
          notebook_id?: string
          role?: string
          sources?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      notebook_notes: {
        Row: {
          content: string
          created_at: string
          id: string
          notebook_id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          id?: string
          notebook_id: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          notebook_id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notebooks: {
        Row: {
          color: string | null
          created_at: string
          description: string
          icon: string | null
          id: string
          is_archived: boolean
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string
          icon?: string | null
          id?: string
          is_archived?: boolean
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string
          icon?: string | null
          id?: string
          is_archived?: boolean
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          banner_url: string | null
          bio: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          location: string | null
          phone: string | null
          plan: string
          updated_at: string
          user_id: string
          username: string | null
          website: string | null
        }
        Insert: {
          avatar_url?: string | null
          banner_url?: string | null
          bio?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          location?: string | null
          phone?: string | null
          plan?: string
          updated_at?: string
          user_id: string
          username?: string | null
          website?: string | null
        }
        Update: {
          avatar_url?: string | null
          banner_url?: string | null
          bio?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          location?: string | null
          phone?: string | null
          plan?: string
          updated_at?: string
          user_id?: string
          username?: string | null
          website?: string | null
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string
          description: string
          id: string
          is_archived: boolean
          language: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          is_archived?: boolean
          language?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          is_archived?: boolean
          language?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      shares: {
        Row: {
          created_at: string
          id: string
          item_id: string
          item_type: string
          permission: string
          shared_by_user_id: string
          shared_with_user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_id: string
          item_type: string
          permission?: string
          shared_by_user_id: string
          shared_with_user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string
          item_type?: string
          permission?: string
          shared_by_user_id?: string
          shared_with_user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          agent_action_notifications: boolean
          auto_accept_invitations: boolean
          auto_summarize: boolean
          chat_suggestions: boolean
          cite_sources: boolean
          created_at: string
          enable_answer_formatting: boolean
          generation_sound: string
          id: string
          language_preference: string
          layout_preference: string
          preferred_model: string
          response_length: string
          retrieval_depth: string
          show_suggested_prompts: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_action_notifications?: boolean
          auto_accept_invitations?: boolean
          auto_summarize?: boolean
          chat_suggestions?: boolean
          cite_sources?: boolean
          created_at?: string
          enable_answer_formatting?: boolean
          generation_sound?: string
          id?: string
          language_preference?: string
          layout_preference?: string
          preferred_model?: string
          response_length?: string
          retrieval_depth?: string
          show_suggested_prompts?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_action_notifications?: boolean
          auto_accept_invitations?: boolean
          auto_summarize?: boolean
          chat_suggestions?: boolean
          cite_sources?: boolean
          created_at?: string
          enable_answer_formatting?: boolean
          generation_sound?: string
          id?: string
          language_preference?: string
          layout_preference?: string
          preferred_model?: string
          response_length?: string
          retrieval_depth?: string
          show_suggested_prompts?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_document_chunk_stats: {
        Args: { doc_ids: string[] }
        Returns: {
          avg_token_count: number
          chunk_count: number
          document_id: string
          embedded_count: number
        }[]
      }
      get_email_by_username: {
        Args: { lookup_username: string }
        Returns: string
      }
      search_document_chunks: {
        Args: {
          filter_chat_id?: string
          filter_notebook_id?: string
          filter_project_id?: string
          match_count?: number
          query_embedding: string
          similarity_threshold?: number
        }
        Returns: {
          chat_id: string
          chunk_id: string
          chunk_index: number
          chunk_text: string
          document_id: string
          file_name: string
          language: string
          metadata_json: Json
          notebook_id: string
          page: number
          project_id: string
          section: string
          similarity: number
          token_count: number
        }[]
      }
      search_documents: {
        Args: { search_query: string }
        Returns: {
          chat_id: string
          document_id: string
          file_name: string
          processing_status: string
          project_id: string
          rank: number
          snippet: string
          summary: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
