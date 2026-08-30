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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      api_call_quotas: {
        Row: {
          count: number
          day: string
          endpoint: string
          user_id: string
        }
        Insert: {
          count?: number
          day?: string
          endpoint: string
          user_id: string
        }
        Update: {
          count?: number
          day?: string
          endpoint?: string
          user_id?: string
        }
        Relationships: []
      }
      budget_categories: {
        Row: {
          amount: number
          created_at: string
          id: string
          label: string
          trip_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          label: string
          trip_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          label?: string
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "budget_categories_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          plan: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          plan?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          plan?: string
          updated_at?: string
        }
        Relationships: []
      }
      reminders: {
        Row: {
          created_at: string
          date: string
          id: string
          title: string
          trip_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          title: string
          trip_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          title?: string
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminders_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      reservations: {
        Row: {
          confirmation_number: string | null
          created_at: string
          end_address: string | null
          end_at: string | null
          end_city: string | null
          end_lat: number | null
          end_lng: number | null
          end_place_name: string | null
          end_time_is_default: boolean
          end_timezone: string | null
          id: string
          name: string
          note: string | null
          place_category: string | null
          place_google_id: string | null
          place_opening_hours: Json | null
          place_photo_ref: string | null
          place_rating: number | null
          place_user_ratings_total: number | null
          price_amount: number | null
          price_currency: string | null
          start_address: string | null
          start_at: string | null
          start_city: string | null
          start_lat: number | null
          start_lng: number | null
          start_place_name: string | null
          start_time_is_default: boolean
          start_timezone: string | null
          status: Database["public"]["Enums"]["reservation_status"]
          stay_check_in_deadline: string | null
          stay_parking_included: boolean | null
          stay_subtype: Database["public"]["Enums"]["stay_subtype"] | null
          transport_subtype:
            | Database["public"]["Enums"]["transport_subtype"]
            | null
          trip_id: string
          type: Database["public"]["Enums"]["reservation_type"]
          updated_at: string
        }
        Insert: {
          confirmation_number?: string | null
          created_at?: string
          end_address?: string | null
          end_at?: string | null
          end_city?: string | null
          end_lat?: number | null
          end_lng?: number | null
          end_place_name?: string | null
          end_time_is_default?: boolean
          end_timezone?: string | null
          id?: string
          name: string
          note?: string | null
          place_category?: string | null
          place_google_id?: string | null
          place_opening_hours?: Json | null
          place_photo_ref?: string | null
          place_rating?: number | null
          place_user_ratings_total?: number | null
          price_amount?: number | null
          price_currency?: string | null
          start_address?: string | null
          start_at?: string | null
          start_city?: string | null
          start_lat?: number | null
          start_lng?: number | null
          start_place_name?: string | null
          start_time_is_default?: boolean
          start_timezone?: string | null
          status?: Database["public"]["Enums"]["reservation_status"]
          stay_check_in_deadline?: string | null
          stay_parking_included?: boolean | null
          stay_subtype?: Database["public"]["Enums"]["stay_subtype"] | null
          transport_subtype?:
            | Database["public"]["Enums"]["transport_subtype"]
            | null
          trip_id: string
          type: Database["public"]["Enums"]["reservation_type"]
          updated_at?: string
        }
        Update: {
          confirmation_number?: string | null
          created_at?: string
          end_address?: string | null
          end_at?: string | null
          end_city?: string | null
          end_lat?: number | null
          end_lng?: number | null
          end_place_name?: string | null
          end_time_is_default?: boolean
          end_timezone?: string | null
          id?: string
          name?: string
          note?: string | null
          place_category?: string | null
          place_google_id?: string | null
          place_opening_hours?: Json | null
          place_photo_ref?: string | null
          place_rating?: number | null
          place_user_ratings_total?: number | null
          price_amount?: number | null
          price_currency?: string | null
          start_address?: string | null
          start_at?: string | null
          start_city?: string | null
          start_lat?: number | null
          start_lng?: number | null
          start_place_name?: string | null
          start_time_is_default?: boolean
          start_timezone?: string | null
          status?: Database["public"]["Enums"]["reservation_status"]
          stay_check_in_deadline?: string | null
          stay_parking_included?: boolean | null
          stay_subtype?: Database["public"]["Enums"]["stay_subtype"] | null
          transport_subtype?:
            | Database["public"]["Enums"]["transport_subtype"]
            | null
          trip_id?: string
          type?: Database["public"]["Enums"]["reservation_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservations_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      souvenir_items: {
        Row: {
          created_at: string
          id: string
          is_checked: boolean
          label: string
          trip_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_checked?: boolean
          label: string
          trip_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_checked?: boolean
          label?: string
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "souvenir_items_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_day_locations: {
        Row: {
          address: string | null
          city: string | null
          created_at: string
          date: string
          id: string
          lat: number
          lng: number
          place_name: string
          timezone: string | null
          trip_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string
          date: string
          id?: string
          lat: number
          lng: number
          place_name: string
          timezone?: string | null
          trip_id: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string
          date?: string
          id?: string
          lat?: number
          lng?: number
          place_name?: string
          timezone?: string | null
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_day_locations_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_day_notes: {
        Row: {
          created_at: string
          date: string
          id: string
          note: string
          trip_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          note: string
          trip_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          note?: string
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_day_notes_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_leg_travel_modes: {
        Row: {
          computed_at: string | null
          created_at: string
          dismissed_at: string | null
          distance_meters: number | null
          duration_seconds: number | null
          from_reservation_id: string
          id: string
          mode: Database["public"]["Enums"]["travel_mode"]
          to_reservation_id: string
          trip_id: string
          updated_at: string
        }
        Insert: {
          computed_at?: string | null
          created_at?: string
          dismissed_at?: string | null
          distance_meters?: number | null
          duration_seconds?: number | null
          from_reservation_id: string
          id?: string
          mode: Database["public"]["Enums"]["travel_mode"]
          to_reservation_id: string
          trip_id: string
          updated_at?: string
        }
        Update: {
          computed_at?: string | null
          created_at?: string
          dismissed_at?: string | null
          distance_meters?: number | null
          duration_seconds?: number | null
          from_reservation_id?: string
          id?: string
          mode?: Database["public"]["Enums"]["travel_mode"]
          to_reservation_id?: string
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_leg_travel_modes_from_reservation_id_fkey"
            columns: ["from_reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_leg_travel_modes_to_reservation_id_fkey"
            columns: ["to_reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_leg_travel_modes_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trips: {
        Row: {
          created_at: string
          currency: string
          day_end_time: string
          day_start_time: string
          destinations: string[]
          end_date: string | null
          id: string
          name: string
          note: string | null
          organizer_id: string
          start_date: string | null
          traveler_count: number
          trip_type: Database["public"]["Enums"]["trip_type"] | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency: string
          day_end_time?: string
          day_start_time?: string
          destinations?: string[]
          end_date?: string | null
          id?: string
          name: string
          note?: string | null
          organizer_id: string
          start_date?: string | null
          traveler_count?: number
          trip_type?: Database["public"]["Enums"]["trip_type"] | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          day_end_time?: string
          day_start_time?: string
          destinations?: string[]
          end_date?: string | null
          id?: string
          name?: string
          note?: string | null
          organizer_id?: string
          start_date?: string | null
          traveler_count?: number
          trip_type?: Database["public"]["Enums"]["trip_type"] | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      increment_api_call_counter: {
        Args: { p_endpoint: string }
        Returns: number
      }
    }
    Enums: {
      reservation_status: "booked" | "to_book" | "decide_later"
      reservation_type: "stay" | "transport" | "activity"
      stay_subtype: "hotel" | "camping" | "airbnb" | "ryokan" | "other"
      transport_subtype: "point_to_point" | "at_disposal"
      travel_mode: "DRIVE" | "WALK" | "BICYCLE" | "TRANSIT" | "TRAIN"
      trip_type: "city_trip" | "road_trip" | "multi_destination" | "other"
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
      reservation_status: ["booked", "to_book", "decide_later"],
      reservation_type: ["stay", "transport", "activity"],
      stay_subtype: ["hotel", "camping", "airbnb", "ryokan", "other"],
      transport_subtype: ["point_to_point", "at_disposal"],
      travel_mode: ["DRIVE", "WALK", "BICYCLE", "TRANSIT", "TRAIN"],
      trip_type: ["city_trip", "road_trip", "multi_destination", "other"],
    },
  },
} as const
