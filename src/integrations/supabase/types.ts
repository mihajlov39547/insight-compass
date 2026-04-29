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
      activity_attempts: {
        Row: {
          activity_run_id: string
          attempt_number: number
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          duration_ms: number | null
          error_details: Json | null
          error_message: string | null
          finished_at: string | null
          id: string
          input_payload: Json | null
          lease_expires_at: string | null
          output_payload: Json | null
          started_at: string | null
          workflow_run_id: string
        }
        Insert: {
          activity_run_id: string
          attempt_number: number
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          duration_ms?: number | null
          error_details?: Json | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          input_payload?: Json | null
          lease_expires_at?: string | null
          output_payload?: Json | null
          started_at?: string | null
          workflow_run_id: string
        }
        Update: {
          activity_run_id?: string
          attempt_number?: number
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          duration_ms?: number | null
          error_details?: Json | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          input_payload?: Json | null
          lease_expires_at?: string | null
          output_payload?: Json | null
          started_at?: string | null
          workflow_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_attempts_activity_run"
            columns: ["activity_run_id"]
            isOneToOne: false
            referencedRelation: "activity_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_attempts_workflow_run"
            columns: ["workflow_run_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_runs: {
        Row: {
          activity_id: string
          activity_key: string
          activity_name: string
          attempt_count: number
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          error_details: Json | null
          error_message: string | null
          execution_priority: number
          finished_at: string | null
          handler_key: string
          id: string
          input_payload: Json | null
          is_optional: boolean
          is_terminal: boolean
          lease_expires_at: string | null
          max_attempts: number
          metadata: Json
          next_retry_at: string | null
          output_payload: Json | null
          queue_msg_id: number | null
          retry_backoff_multiplier: number
          retry_backoff_seconds: number
          scheduled_at: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["activity_run_status"]
          updated_at: string
          version_id: string
          workflow_run_id: string
        }
        Insert: {
          activity_id: string
          activity_key: string
          activity_name: string
          attempt_count?: number
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          error_details?: Json | null
          error_message?: string | null
          execution_priority?: number
          finished_at?: string | null
          handler_key: string
          id?: string
          input_payload?: Json | null
          is_optional?: boolean
          is_terminal?: boolean
          lease_expires_at?: string | null
          max_attempts?: number
          metadata?: Json
          next_retry_at?: string | null
          output_payload?: Json | null
          queue_msg_id?: number | null
          retry_backoff_multiplier?: number
          retry_backoff_seconds?: number
          scheduled_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["activity_run_status"]
          updated_at?: string
          version_id: string
          workflow_run_id: string
        }
        Update: {
          activity_id?: string
          activity_key?: string
          activity_name?: string
          attempt_count?: number
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          error_details?: Json | null
          error_message?: string | null
          execution_priority?: number
          finished_at?: string | null
          handler_key?: string
          id?: string
          input_payload?: Json | null
          is_optional?: boolean
          is_terminal?: boolean
          lease_expires_at?: string | null
          max_attempts?: number
          metadata?: Json
          next_retry_at?: string | null
          output_payload?: Json | null
          queue_msg_id?: number | null
          retry_backoff_multiplier?: number
          retry_backoff_seconds?: number
          scheduled_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["activity_run_status"]
          updated_at?: string
          version_id?: string
          workflow_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_runs_version_activity_fkey"
            columns: ["version_id", "activity_id"]
            isOneToOne: false
            referencedRelation: "workflow_activities"
            referencedColumns: ["version_id", "id"]
          },
          {
            foreignKeyName: "activity_runs_workflow_run_id_fkey"
            columns: ["workflow_run_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
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
      document_chunk_questions: {
        Row: {
          chat_id: string | null
          chunk_id: string
          created_at: string
          document_id: string
          embedding: string | null
          embedding_version: string | null
          generation_model: string | null
          id: string
          is_grounded: boolean
          notebook_id: string | null
          position: number
          project_id: string | null
          question_text: string
          updated_at: string
          user_id: string
        }
        Insert: {
          chat_id?: string | null
          chunk_id: string
          created_at?: string
          document_id: string
          embedding?: string | null
          embedding_version?: string | null
          generation_model?: string | null
          id?: string
          is_grounded?: boolean
          notebook_id?: string | null
          position: number
          project_id?: string | null
          question_text: string
          updated_at?: string
          user_id: string
        }
        Update: {
          chat_id?: string | null
          chunk_id?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          embedding_version?: string | null
          generation_model?: string | null
          id?: string
          is_grounded?: boolean
          notebook_id?: string | null
          position?: number
          project_id?: string | null
          question_text?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_chunk_questions_chunk_id_fkey"
            columns: ["chunk_id"]
            isOneToOne: false
            referencedRelation: "document_chunks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_chunk_questions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
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
          updated_at: string
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
          updated_at?: string
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
          updated_at?: string
          user_id?: string
          word_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_notebook_id_fkey"
            columns: ["notebook_id"]
            isOneToOne: false
            referencedRelation: "notebooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      link_transcript_chunk_questions: {
        Row: {
          chunk_id: string
          created_at: string
          embedding: string | null
          embedding_version: string | null
          generation_model: string | null
          id: string
          is_grounded: boolean
          metadata_json: Json
          notebook_id: string | null
          position: number
          project_id: string | null
          question_text: string
          resource_link_id: string
          search_vector: unknown
          updated_at: string
          user_id: string
        }
        Insert: {
          chunk_id: string
          created_at?: string
          embedding?: string | null
          embedding_version?: string | null
          generation_model?: string | null
          id?: string
          is_grounded?: boolean
          metadata_json?: Json
          notebook_id?: string | null
          position?: number
          project_id?: string | null
          question_text: string
          resource_link_id: string
          search_vector?: unknown
          updated_at?: string
          user_id: string
        }
        Update: {
          chunk_id?: string
          created_at?: string
          embedding?: string | null
          embedding_version?: string | null
          generation_model?: string | null
          id?: string
          is_grounded?: boolean
          metadata_json?: Json
          notebook_id?: string | null
          position?: number
          project_id?: string | null
          question_text?: string
          resource_link_id?: string
          search_vector?: unknown
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "link_transcript_chunk_questions_chunk_id_fkey"
            columns: ["chunk_id"]
            isOneToOne: false
            referencedRelation: "link_transcript_chunks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "link_transcript_chunk_questions_notebook_id_fkey"
            columns: ["notebook_id"]
            isOneToOne: false
            referencedRelation: "notebooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "link_transcript_chunk_questions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "link_transcript_chunk_questions_resource_link_id_fkey"
            columns: ["resource_link_id"]
            isOneToOne: false
            referencedRelation: "resource_links"
            referencedColumns: ["id"]
          },
        ]
      }
      link_transcript_chunks: {
        Row: {
          chunk_index: number
          chunk_text: string
          created_at: string
          embedding: string | null
          id: string
          metadata_json: Json
          notebook_id: string | null
          project_id: string | null
          resource_link_id: string
          search_vector: unknown
          token_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          chunk_index: number
          chunk_text: string
          created_at?: string
          embedding?: string | null
          id?: string
          metadata_json?: Json
          notebook_id?: string | null
          project_id?: string | null
          resource_link_id: string
          search_vector?: unknown
          token_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          chunk_index?: number
          chunk_text?: string
          created_at?: string
          embedding?: string | null
          id?: string
          metadata_json?: Json
          notebook_id?: string | null
          project_id?: string | null
          resource_link_id?: string
          search_vector?: unknown
          token_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "link_transcript_chunks_notebook_id_fkey"
            columns: ["notebook_id"]
            isOneToOne: false
            referencedRelation: "notebooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "link_transcript_chunks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "link_transcript_chunks_resource_link_id_fkey"
            columns: ["resource_link_id"]
            isOneToOne: false
            referencedRelation: "resource_links"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "notebook_messages_notebook_id_fkey"
            columns: ["notebook_id"]
            isOneToOne: false
            referencedRelation: "notebooks"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "notebook_notes_notebook_id_fkey"
            columns: ["notebook_id"]
            isOneToOne: false
            referencedRelation: "notebooks"
            referencedColumns: ["id"]
          },
        ]
      }
      notebooks: {
        Row: {
          color: string | null
          created_at: string
          description: string
          icon: string | null
          id: string
          is_archived: boolean
          language: string
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
          language?: string
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
          language?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pending_registrations: {
        Row: {
          attempts: number
          code_hash: string
          created_at: string
          email: string
          expires_at: string
          id: string
          password_hash: string
        }
        Insert: {
          attempts?: number
          code_hash: string
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          password_hash: string
        }
        Update: {
          attempts?: number
          code_hash?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          password_hash?: string
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
      queue_dispatches: {
        Row: {
          activity_run_id: string
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          dead_lettered_at: string | null
          enqueued_at: string
          error_message: string | null
          id: string
          idempotency_key: string | null
          metadata: Json
          pgmq_msg_id: number | null
          queue_name: string
          status: string
          workflow_run_id: string
        }
        Insert: {
          activity_run_id: string
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          dead_lettered_at?: string | null
          enqueued_at?: string
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          pgmq_msg_id?: number | null
          queue_name: string
          status?: string
          workflow_run_id: string
        }
        Update: {
          activity_run_id?: string
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          dead_lettered_at?: string | null
          enqueued_at?: string
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          pgmq_msg_id?: number | null
          queue_name?: string
          status?: string
          workflow_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "queue_dispatches_activity_run_id_fkey"
            columns: ["activity_run_id"]
            isOneToOne: false
            referencedRelation: "activity_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "queue_dispatches_workflow_run_id_fkey"
            columns: ["workflow_run_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_links: {
        Row: {
          adapter_key: string | null
          created_at: string
          id: string
          media_channel_name: string | null
          media_duration_seconds: number | null
          media_thumbnail_url: string | null
          media_video_id: string | null
          metadata: Json
          normalized_url: string | null
          notebook_enabled: boolean
          notebook_id: string | null
          preview_domain: string | null
          preview_favicon_url: string | null
          preview_title: string | null
          project_id: string | null
          provider: string
          resource_type: string
          source_type: string
          status: string
          title: string
          transcript_error: string | null
          transcript_status: string
          transcript_updated_at: string | null
          updated_at: string
          url: string
          user_id: string
        }
        Insert: {
          adapter_key?: string | null
          created_at?: string
          id?: string
          media_channel_name?: string | null
          media_duration_seconds?: number | null
          media_thumbnail_url?: string | null
          media_video_id?: string | null
          metadata?: Json
          normalized_url?: string | null
          notebook_enabled?: boolean
          notebook_id?: string | null
          preview_domain?: string | null
          preview_favicon_url?: string | null
          preview_title?: string | null
          project_id?: string | null
          provider?: string
          resource_type?: string
          source_type?: string
          status?: string
          title: string
          transcript_error?: string | null
          transcript_status?: string
          transcript_updated_at?: string | null
          updated_at?: string
          url: string
          user_id: string
        }
        Update: {
          adapter_key?: string | null
          created_at?: string
          id?: string
          media_channel_name?: string | null
          media_duration_seconds?: number | null
          media_thumbnail_url?: string | null
          media_video_id?: string | null
          metadata?: Json
          normalized_url?: string | null
          notebook_enabled?: boolean
          notebook_id?: string | null
          preview_domain?: string | null
          preview_favicon_url?: string | null
          preview_title?: string | null
          project_id?: string | null
          provider?: string
          resource_type?: string
          source_type?: string
          status?: string
          title?: string
          transcript_error?: string | null
          transcript_status?: string
          transcript_updated_at?: string | null
          updated_at?: string
          url?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_links_notebook_id_fkey"
            columns: ["notebook_id"]
            isOneToOne: false
            referencedRelation: "notebooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_links_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      shares: {
        Row: {
          created_at: string
          id: string
          item_id: string
          item_type: string
          permission: string
          shared_by_user_id: string
          shared_with_email: string | null
          shared_with_user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          item_id: string
          item_type: string
          permission?: string
          shared_by_user_id: string
          shared_with_email?: string | null
          shared_with_user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string
          item_type?: string
          permission?: string
          shared_by_user_id?: string
          shared_with_email?: string | null
          shared_with_user_id?: string | null
        }
        Relationships: []
      }
      source_connection_requests: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          metadata: Json
          provider: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          metadata?: Json
          provider: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          metadata?: Json
          provider?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      user_inbox_messages: {
        Row: {
          action_label: string | null
          action_url: string | null
          body: string | null
          created_at: string
          id: string
          is_read: boolean | null
          kind: string
          metadata: Json
          read_at: string | null
          source_id: string | null
          source_type: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          action_label?: string | null
          action_url?: string | null
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean | null
          kind?: string
          metadata?: Json
          read_at?: string | null
          source_id?: string | null
          source_type?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          action_label?: string | null
          action_url?: string | null
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean | null
          kind?: string
          metadata?: Json
          read_at?: string | null
          source_id?: string | null
          source_type?: string | null
          title?: string
          updated_at?: string
          user_id?: string
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
          retrieval_chunk_weight: number
          retrieval_depth: string
          retrieval_keyword_weight: number
          retrieval_question_weight: number
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
          retrieval_chunk_weight?: number
          retrieval_depth?: string
          retrieval_keyword_weight?: number
          retrieval_question_weight?: number
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
          retrieval_chunk_weight?: number
          retrieval_depth?: string
          retrieval_keyword_weight?: number
          retrieval_question_weight?: number
          show_suggested_prompts?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      web_search_responses: {
        Row: {
          chat_id: string | null
          created_at: string
          error_message: string | null
          follow_up_questions: Json | null
          id: string
          images: Json
          message_id: string | null
          metadata: Json
          normalized_response: Json
          project_id: string | null
          provider: string
          provider_answer: string | null
          provider_request_id: string | null
          provider_response_time: number | null
          query: string
          raw_response: Json
          results: Json
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          chat_id?: string | null
          created_at?: string
          error_message?: string | null
          follow_up_questions?: Json | null
          id?: string
          images?: Json
          message_id?: string | null
          metadata?: Json
          normalized_response: Json
          project_id?: string | null
          provider: string
          provider_answer?: string | null
          provider_request_id?: string | null
          provider_response_time?: number | null
          query: string
          raw_response: Json
          results?: Json
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          chat_id?: string | null
          created_at?: string
          error_message?: string | null
          follow_up_questions?: Json | null
          id?: string
          images?: Json
          message_id?: string | null
          metadata?: Json
          normalized_response?: Json
          project_id?: string | null
          provider?: string
          provider_answer?: string | null
          provider_request_id?: string | null
          provider_response_time?: number | null
          query?: string
          raw_response?: Json
          results?: Json
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      whats_new_article_localizations: {
        Row: {
          article_id: string
          created_at: string
          description: string
          locale: string
          title: string
          updated_at: string
        }
        Insert: {
          article_id: string
          created_at?: string
          description: string
          locale: string
          title: string
          updated_at?: string
        }
        Update: {
          article_id?: string
          created_at?: string
          description?: string
          locale?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whats_new_article_localizations_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "whats_new_articles"
            referencedColumns: ["id"]
          },
        ]
      }
      whats_new_articles: {
        Row: {
          created_at: string
          id: string
          image_url: string | null
          is_published: boolean
          published_at: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_url?: string | null
          is_published?: boolean
          published_at?: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string | null
          is_published?: boolean
          published_at?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      workflow_activities: {
        Row: {
          concurrency_key: string | null
          created_at: string
          description: string
          execution_priority: number
          handler_key: string
          id: string
          is_entry: boolean
          is_optional: boolean
          is_terminal: boolean
          key: string
          metadata: Json
          name: string
          retry_backoff_multiplier: number
          retry_backoff_seconds: number
          retry_max_attempts: number
          timeout_seconds: number | null
          version_id: string
          writes_output: boolean
        }
        Insert: {
          concurrency_key?: string | null
          created_at?: string
          description?: string
          execution_priority?: number
          handler_key: string
          id?: string
          is_entry?: boolean
          is_optional?: boolean
          is_terminal?: boolean
          key: string
          metadata?: Json
          name: string
          retry_backoff_multiplier?: number
          retry_backoff_seconds?: number
          retry_max_attempts?: number
          timeout_seconds?: number | null
          version_id: string
          writes_output?: boolean
        }
        Update: {
          concurrency_key?: string | null
          created_at?: string
          description?: string
          execution_priority?: number
          handler_key?: string
          id?: string
          is_entry?: boolean
          is_optional?: boolean
          is_terminal?: boolean
          key?: string
          metadata?: Json
          name?: string
          retry_backoff_multiplier?: number
          retry_backoff_seconds?: number
          retry_max_attempts?: number
          timeout_seconds?: number | null
          version_id?: string
          writes_output?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "workflow_activities_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "workflow_definition_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_context_snapshots: {
        Row: {
          activity_run_id: string | null
          created_at: string
          id: string
          reason: string
          snapshot_context: Json
          workflow_run_id: string
        }
        Insert: {
          activity_run_id?: string | null
          created_at?: string
          id?: string
          reason?: string
          snapshot_context: Json
          workflow_run_id: string
        }
        Update: {
          activity_run_id?: string | null
          created_at?: string
          id?: string
          reason?: string
          snapshot_context?: Json
          workflow_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_context_snapshots_activity_run_id_fkey"
            columns: ["activity_run_id"]
            isOneToOne: false
            referencedRelation: "activity_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_context_snapshots_workflow_run_id_fkey"
            columns: ["workflow_run_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_definition_versions: {
        Row: {
          created_at: string
          default_context: Json
          description: string
          id: string
          is_current: boolean
          metadata: Json
          version: number
          workflow_definition_id: string
        }
        Insert: {
          created_at?: string
          default_context?: Json
          description?: string
          id?: string
          is_current?: boolean
          metadata?: Json
          version?: number
          workflow_definition_id: string
        }
        Update: {
          created_at?: string
          default_context?: Json
          description?: string
          id?: string
          is_current?: boolean
          metadata?: Json
          version?: number
          workflow_definition_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_definition_versions_workflow_definition_id_fkey"
            columns: ["workflow_definition_id"]
            isOneToOne: false
            referencedRelation: "workflow_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_definitions: {
        Row: {
          created_at: string
          description: string
          id: string
          key: string
          metadata: Json
          name: string
          status: Database["public"]["Enums"]["workflow_definition_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          key: string
          metadata?: Json
          name: string
          status?: Database["public"]["Enums"]["workflow_definition_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          key?: string
          metadata?: Json
          name?: string
          status?: Database["public"]["Enums"]["workflow_definition_status"]
          updated_at?: string
        }
        Relationships: []
      }
      workflow_edges: {
        Row: {
          condition_expr: Json | null
          created_at: string
          from_activity_id: string
          id: string
          join_policy: Database["public"]["Enums"]["edge_join_policy"]
          metadata: Json
          to_activity_id: string
          version_id: string
        }
        Insert: {
          condition_expr?: Json | null
          created_at?: string
          from_activity_id: string
          id?: string
          join_policy?: Database["public"]["Enums"]["edge_join_policy"]
          metadata?: Json
          to_activity_id: string
          version_id: string
        }
        Update: {
          condition_expr?: Json | null
          created_at?: string
          from_activity_id?: string
          id?: string
          join_policy?: Database["public"]["Enums"]["edge_join_policy"]
          metadata?: Json
          to_activity_id?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_edges_from_version_activity_fkey"
            columns: ["version_id", "from_activity_id"]
            isOneToOne: false
            referencedRelation: "workflow_activities"
            referencedColumns: ["version_id", "id"]
          },
          {
            foreignKeyName: "workflow_edges_to_version_activity_fkey"
            columns: ["version_id", "to_activity_id"]
            isOneToOne: false
            referencedRelation: "workflow_activities"
            referencedColumns: ["version_id", "id"]
          },
          {
            foreignKeyName: "workflow_edges_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "workflow_definition_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_events: {
        Row: {
          activity_run_id: string | null
          actor: string | null
          created_at: string
          details: Json
          event_type: Database["public"]["Enums"]["workflow_event_type"]
          id: string
          workflow_run_id: string
        }
        Insert: {
          activity_run_id?: string | null
          actor?: string | null
          created_at?: string
          details?: Json
          event_type: Database["public"]["Enums"]["workflow_event_type"]
          id?: string
          workflow_run_id: string
        }
        Update: {
          activity_run_id?: string | null
          actor?: string | null
          created_at?: string
          details?: Json
          event_type?: Database["public"]["Enums"]["workflow_event_type"]
          id?: string
          workflow_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_events_activity_run_id_fkey"
            columns: ["activity_run_id"]
            isOneToOne: false
            referencedRelation: "activity_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_events_workflow_run_id_fkey"
            columns: ["workflow_run_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_runs: {
        Row: {
          completed_at: string | null
          context: Json
          created_at: string
          failure_reason: string | null
          id: string
          idempotency_key: string | null
          input_payload: Json
          last_heartbeat_at: string | null
          metadata: Json
          output_payload: Json | null
          started_at: string | null
          status: Database["public"]["Enums"]["workflow_run_status"]
          timeout_seconds: number | null
          trigger_entity_id: string | null
          trigger_entity_type: string | null
          updated_at: string
          user_id: string | null
          version_id: string
          workflow_definition_id: string
        }
        Insert: {
          completed_at?: string | null
          context?: Json
          created_at?: string
          failure_reason?: string | null
          id?: string
          idempotency_key?: string | null
          input_payload?: Json
          last_heartbeat_at?: string | null
          metadata?: Json
          output_payload?: Json | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["workflow_run_status"]
          timeout_seconds?: number | null
          trigger_entity_id?: string | null
          trigger_entity_type?: string | null
          updated_at?: string
          user_id?: string | null
          version_id: string
          workflow_definition_id: string
        }
        Update: {
          completed_at?: string | null
          context?: Json
          created_at?: string
          failure_reason?: string | null
          id?: string
          idempotency_key?: string | null
          input_payload?: Json
          last_heartbeat_at?: string | null
          metadata?: Json
          output_payload?: Json | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["workflow_run_status"]
          timeout_seconds?: number | null
          trigger_entity_id?: string | null
          trigger_entity_type?: string | null
          updated_at?: string
          user_id?: string | null
          version_id?: string
          workflow_definition_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_runs_def_version_fkey"
            columns: ["workflow_definition_id", "version_id"]
            isOneToOne: false
            referencedRelation: "workflow_definition_versions"
            referencedColumns: ["workflow_definition_id", "id"]
          },
          {
            foreignKeyName: "workflow_runs_workflow_definition_id_fkey"
            columns: ["workflow_definition_id"]
            isOneToOne: false
            referencedRelation: "workflow_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      youtube_transcript_jobs: {
        Row: {
          attempt_count: number
          created_at: string
          error_message: string | null
          finished_at: string | null
          id: string
          lease_expires_at: string | null
          max_attempts: number
          requested_by: string
          resource_link_id: string
          started_at: string | null
          status: string
          transcript_text: string | null
          updated_at: string
          worker_id: string | null
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          lease_expires_at?: string | null
          max_attempts?: number
          requested_by: string
          resource_link_id: string
          started_at?: string | null
          status?: string
          transcript_text?: string | null
          updated_at?: string
          worker_id?: string | null
        }
        Update: {
          attempt_count?: number
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          lease_expires_at?: string | null
          max_attempts?: number
          requested_by?: string
          resource_link_id?: string
          started_at?: string | null
          status?: string
          transcript_text?: string | null
          updated_at?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "youtube_transcript_jobs_resource_link_id_fkey"
            columns: ["resource_link_id"]
            isOneToOne: false
            referencedRelation: "resource_links"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_item_permission: {
        Args: {
          p_item_id: string
          p_item_type: string
          p_min_role: string
          p_user_id: string
        }
        Returns: boolean
      }
      claim_next_activity: {
        Args: {
          p_handler_keys?: string[]
          p_lease_seconds?: number
          p_worker_id: string
        }
        Returns: string
      }
      claim_next_youtube_transcript_job: {
        Args: { p_lease_seconds?: number; p_worker_id: string }
        Returns: {
          attempt_count: number
          job_id: string
          max_attempts: number
          normalized_url: string
          resource_id: string
          video_id: string
        }[]
      }
      cleanup_expired_pending_registrations: { Args: never; Returns: undefined }
      complete_youtube_transcript_job: {
        Args: {
          p_chunk_count?: number
          p_error?: string
          p_job_id: string
          p_success: boolean
          p_transcript_text?: string
          p_worker_id?: string
        }
        Returns: {
          job_id: string
          resource_id: string
          transcript_status: string
        }[]
      }
      create_link_resource_stub: {
        Args: {
          p_container_id?: string
          p_container_type?: string
          p_provider?: string
          p_title?: string
          p_url: string
        }
        Returns: {
          created_at: string
          id: string
          title: string
          url: string
        }[]
      }
      create_source_connection_request_stub: {
        Args: { p_display_name?: string; p_metadata?: Json; p_provider: string }
        Returns: {
          created_at: string
          id: string
          provider: string
          status: string
        }[]
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      detect_source_provider_from_url: {
        Args: { p_url: string }
        Returns: string
      }
      edge_condition_matches: {
        Args: { p_condition_expr: Json; p_context: Json }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      enqueue_youtube_transcript_job: {
        Args: { p_force_retry?: boolean; p_resource_id: string }
        Returns: {
          job_id: string
          transcript_status: string
        }[]
      }
      extract_url_domain: { Args: { p_url: string }; Returns: string }
      extract_youtube_video_id: { Args: { p_url: string }; Returns: string }
      find_user_id_by_email: { Args: { _email: string }; Returns: string }
      get_document_chunk_stats: {
        Args: { doc_ids: string[] }
        Returns: {
          avg_token_count: number
          chunk_count: number
          document_id: string
          embedded_count: number
        }[]
      }
      get_document_processing_status: {
        Args: { p_document_id: string }
        Returns: Json
      }
      get_document_question_stats: {
        Args: { doc_ids: string[] }
        Returns: {
          document_id: string
          embedded_question_count: number
          question_count: number
        }[]
      }
      get_email_by_username: {
        Args: { lookup_username: string }
        Returns: string
      }
      get_link_transcript_preview: {
        Args: { p_limit?: number; p_query?: string; p_resource_id: string }
        Returns: {
          chunk_index: number
          chunk_text: string
          match_rank: number
          token_count: number
        }[]
      }
      get_public_profile: {
        Args: { _user_id: string }
        Returns: {
          avatar_url: string
          email: string
          full_name: string
          user_id: string
          username: string
        }[]
      }
      get_public_profiles: {
        Args: { _user_ids: string[] }
        Returns: {
          avatar_url: string
          email: string
          full_name: string
          user_id: string
          username: string
        }[]
      }
      get_user_item_role: {
        Args: { p_item_id: string; p_item_type: string; p_user_id: string }
        Returns: string
      }
      get_user_resources: {
        Args: never
        Returns: {
          can_delete: boolean
          can_download: boolean
          can_open: boolean
          can_rename: boolean
          can_retry: boolean
          can_view_details: boolean
          chat_id: string
          chat_name: string
          container_id: string
          container_name: string
          container_path: string
          container_type: string
          detected_language: string
          extension: string
          id: string
          is_owned_by_me: boolean
          is_shared: boolean
          is_shared_with_me: boolean
          link_url: string
          media_channel_name: string
          media_duration_seconds: number
          media_thumbnail_url: string
          media_video_id: string
          mime_type: string
          normalized_url: string
          notebook_id: string
          notebook_name: string
          owner_display_name: string
          owner_user_id: string
          page_count: number
          preview_domain: string
          preview_favicon_url: string
          preview_title: string
          processing_error: string
          processing_status: string
          project_id: string
          project_name: string
          provider: string
          resource_kind: string
          resource_type: string
          size_bytes: number
          source_type: string
          storage_path: string
          summary: string
          title: string
          transcript_error: string
          transcript_status: string
          updated_at: string
          uploaded_at: string
          word_count: number
        }[]
      }
      get_user_resources_v6_base: {
        Args: never
        Returns: {
          can_delete: boolean
          can_download: boolean
          can_open: boolean
          can_rename: boolean
          can_retry: boolean
          can_view_details: boolean
          chat_id: string
          chat_name: string
          container_id: string
          container_name: string
          container_path: string
          container_type: string
          detected_language: string
          extension: string
          id: string
          is_owned_by_me: boolean
          is_shared: boolean
          is_shared_with_me: boolean
          link_url: string
          media_channel_name: string
          media_duration_seconds: number
          media_thumbnail_url: string
          media_video_id: string
          mime_type: string
          normalized_url: string
          notebook_id: string
          notebook_name: string
          owner_display_name: string
          owner_user_id: string
          page_count: number
          preview_domain: string
          preview_favicon_url: string
          preview_title: string
          processing_error: string
          processing_status: string
          project_id: string
          project_name: string
          provider: string
          resource_kind: string
          resource_type: string
          size_bytes: number
          source_type: string
          storage_path: string
          summary: string
          title: string
          transcript_error: string
          transcript_status: string
          updated_at: string
          uploaded_at: string
          word_count: number
        }[]
      }
      is_activity_runnable: {
        Args: { p_activity_id: string; p_workflow_run_id: string }
        Returns: boolean
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      normalize_resource_url: { Args: { p_url: string }; Returns: string }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      rename_user_resource: {
        Args: { p_new_title: string; p_resource_id: string }
        Returns: {
          id: string
          title: string
          updated_at: string
        }[]
      }
      run_link_adapter_enrichment: {
        Args: { p_resource_id: string }
        Returns: {
          id: string
          provider: string
          status: string
        }[]
      }
      schedule_downstream_activities: {
        Args: {
          p_actor?: string
          p_completed_activity_id: string
          p_workflow_run_id: string
        }
        Returns: string[]
      }
      search_document_chunk_questions: {
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
          question_id: string
          question_text: string
          section: string
          similarity: number
          token_count: number
        }[]
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
      search_link_transcript_chunk_questions: {
        Args: {
          filter_notebook_id?: string
          filter_project_id?: string
          match_count?: number
          query_embedding: string
          similarity_threshold?: number
        }
        Returns: {
          chunk_id: string
          chunk_index: number
          chunk_text: string
          media_video_id: string
          normalized_url: string
          notebook_id: string
          project_id: string
          question_id: string
          question_text: string
          resource_id: string
          resource_title: string
          similarity: number
          transcript_status: string
        }[]
      }
      search_link_transcript_chunks: {
        Args: {
          filter_notebook_id?: string
          filter_project_id?: string
          match_count?: number
          query_embedding: string
          similarity_threshold?: number
        }
        Returns: {
          chunk_id: string
          chunk_index: number
          chunk_text: string
          media_video_id: string
          normalized_url: string
          notebook_id: string
          project_id: string
          resource_id: string
          resource_title: string
          similarity: number
          transcript_status: string
        }[]
      }
      workflow_reachable_activity_ids: {
        Args: { p_workflow_run_id: string }
        Returns: {
          activity_id: string
        }[]
      }
    }
    Enums: {
      activity_run_status:
        | "pending"
        | "queued"
        | "claimed"
        | "running"
        | "completed"
        | "failed"
        | "skipped"
        | "cancelled"
        | "waiting_retry"
      edge_join_policy: "all" | "any"
      workflow_definition_status: "draft" | "active" | "inactive" | "archived"
      workflow_event_type:
        | "workflow_created"
        | "workflow_started"
        | "workflow_completed"
        | "workflow_failed"
        | "workflow_cancelled"
        | "workflow_timed_out"
        | "workflow_context_updated"
        | "activity_scheduled"
        | "activity_queued"
        | "activity_claimed"
        | "activity_started"
        | "activity_completed"
        | "activity_failed"
        | "activity_retrying"
        | "activity_skipped"
        | "activity_cancelled"
        | "activity_output_written"
        | "activity_heartbeat"
      workflow_run_status:
        | "pending"
        | "running"
        | "completed"
        | "failed"
        | "cancelled"
        | "timed_out"
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
    Enums: {
      activity_run_status: [
        "pending",
        "queued",
        "claimed",
        "running",
        "completed",
        "failed",
        "skipped",
        "cancelled",
        "waiting_retry",
      ],
      edge_join_policy: ["all", "any"],
      workflow_definition_status: ["draft", "active", "inactive", "archived"],
      workflow_event_type: [
        "workflow_created",
        "workflow_started",
        "workflow_completed",
        "workflow_failed",
        "workflow_cancelled",
        "workflow_timed_out",
        "workflow_context_updated",
        "activity_scheduled",
        "activity_queued",
        "activity_claimed",
        "activity_started",
        "activity_completed",
        "activity_failed",
        "activity_retrying",
        "activity_skipped",
        "activity_cancelled",
        "activity_output_written",
        "activity_heartbeat",
      ],
      workflow_run_status: [
        "pending",
        "running",
        "completed",
        "failed",
        "cancelled",
        "timed_out",
      ],
    },
  },
} as const
