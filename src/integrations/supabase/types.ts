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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          context: Json | null
          created_at: string
          id: string
          message: string
          severity: string
        }
        Insert: {
          context?: Json | null
          created_at?: string
          id?: string
          message: string
          severity?: string
        }
        Update: {
          context?: Json | null
          created_at?: string
          id?: string
          message?: string
          severity?: string
        }
        Relationships: []
      }
      orders: {
        Row: {
          created_at: string
          error: string | null
          exchange_order_id: string | null
          filled_at: string | null
          filled_price: number | null
          id: string
          order_type: string
          paper: boolean
          price: number | null
          qty: number
          side: string
          status: string
          symbol: string
          webhook_event_id: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          exchange_order_id?: string | null
          filled_at?: string | null
          filled_price?: number | null
          id?: string
          order_type?: string
          paper?: boolean
          price?: number | null
          qty: number
          side: string
          status?: string
          symbol: string
          webhook_event_id?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          exchange_order_id?: string | null
          filled_at?: string | null
          filled_price?: number | null
          id?: string
          order_type?: string
          paper?: boolean
          price?: number | null
          qty?: number
          side?: string
          status?: string
          symbol?: string
          webhook_event_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_webhook_event_id_fkey"
            columns: ["webhook_event_id"]
            isOneToOne: false
            referencedRelation: "webhook_events"
            referencedColumns: ["id"]
          },
        ]
      }
      owner: {
        Row: {
          created_at: string
          id: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          id?: boolean
          user_id?: string
        }
        Relationships: []
      }
      positions: {
        Row: {
          avg_entry_price: number
          opened_at: string
          paper: boolean
          qty: number
          symbol: string
          updated_at: string
        }
        Insert: {
          avg_entry_price?: number
          opened_at?: string
          paper?: boolean
          qty?: number
          symbol: string
          updated_at?: string
        }
        Update: {
          avg_entry_price?: number
          opened_at?: string
          paper?: boolean
          qty?: number
          symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
      settings: {
        Row: {
          allowed_symbols: string[]
          id: boolean
          kill_switch: boolean
          max_daily_loss_usd: number
          max_open_positions: number
          max_position_usd: number
          paper_mode: boolean
          paper_starting_equity: number
          updated_at: string
        }
        Insert: {
          allowed_symbols?: string[]
          id?: boolean
          kill_switch?: boolean
          max_daily_loss_usd?: number
          max_open_positions?: number
          max_position_usd?: number
          paper_mode?: boolean
          paper_starting_equity?: number
          updated_at?: string
        }
        Update: {
          allowed_symbols?: string[]
          id?: boolean
          kill_switch?: boolean
          max_daily_loss_usd?: number
          max_open_positions?: number
          max_position_usd?: number
          paper_mode?: boolean
          paper_starting_equity?: number
          updated_at?: string
        }
        Relationships: []
      }
      trades: {
        Row: {
          closed_at: string
          entry_price: number
          exit_price: number
          id: string
          opened_at: string
          paper: boolean
          pnl_usd: number
          qty: number
          side: string
          symbol: string
        }
        Insert: {
          closed_at?: string
          entry_price: number
          exit_price: number
          id?: string
          opened_at: string
          paper?: boolean
          pnl_usd: number
          qty: number
          side: string
          symbol: string
        }
        Update: {
          closed_at?: string
          entry_price?: number
          exit_price?: number
          id?: string
          opened_at?: string
          paper?: boolean
          pnl_usd?: number
          qty?: number
          side?: string
          symbol?: string
        }
        Relationships: []
      }
      webhook_events: {
        Row: {
          alert_id: string | null
          id: string
          raw_payload: Json
          reason: string | null
          received_at: string
          status: string
        }
        Insert: {
          alert_id?: string | null
          id?: string
          raw_payload: Json
          reason?: string | null
          received_at?: string
          status?: string
        }
        Update: {
          alert_id?: string | null
          id?: string
          raw_payload?: Json
          reason?: string | null
          received_at?: string
          status?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_ownership: { Args: never; Returns: boolean }
      is_owner: { Args: never; Returns: boolean }
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
