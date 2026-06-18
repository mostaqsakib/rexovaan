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
      bot_balance_adjustments: {
        Row: {
          created_at: string
          customer_id: string
          diff: number
          id: string
          new_balance: number
          note: string
          old_balance: number
          source: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          diff: number
          id?: string
          new_balance: number
          note: string
          old_balance: number
          source?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          diff?: number
          id?: string
          new_balance?: number
          note?: string
          old_balance?: number
          source?: string
        }
        Relationships: []
      }
      bot_broadcast_groups: {
        Row: {
          chat_id: number
          chat_type: string | null
          created_at: string
          id: string
          is_active: boolean
          title: string | null
          updated_at: string
        }
        Insert: {
          chat_id: number
          chat_type?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          title?: string | null
          updated_at?: string
        }
        Update: {
          chat_id?: number
          chat_type?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      bot_button_emojis: {
        Row: {
          button_key: string
          button_label: string
          created_at: string
          custom_emoji_id: string | null
          id: string
          style: string | null
        }
        Insert: {
          button_key: string
          button_label: string
          created_at?: string
          custom_emoji_id?: string | null
          id?: string
          style?: string | null
        }
        Update: {
          button_key?: string
          button_label?: string
          created_at?: string
          custom_emoji_id?: string | null
          id?: string
          style?: string | null
        }
        Relationships: []
      }
      bot_custom_emoji_cache: {
        Row: {
          created_at: string
          emoji_id: string
          fallback: string | null
          fetched_at: string
          lottie_url: string | null
          status: string
        }
        Insert: {
          created_at?: string
          emoji_id: string
          fallback?: string | null
          fetched_at?: string
          lottie_url?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          emoji_id?: string
          fallback?: string | null
          fetched_at?: string
          lottie_url?: string | null
          status?: string
        }
        Relationships: []
      }
      bot_customer_pricing: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          is_active: boolean
          min_quantity: number
          note: string | null
          price: number
          product_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          is_active?: boolean
          min_quantity?: number
          note?: string | null
          price: number
          product_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          is_active?: boolean
          min_quantity?: number
          note?: string | null
          price?: number
          product_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      bot_customers: {
        Row: {
          auth_user_id: string | null
          balance: number
          ban_reason: string | null
          banned_at: string | null
          chat_id: number
          created_at: string
          first_name: string | null
          id: string
          is_banned: boolean
          pay_later_enabled: boolean
          pay_later_limit: number
          pay_later_used: number
          pending_action: string | null
          pending_inputs: Json | null
          referral_balance: number
          referral_total_earned: number
          referral_transferred: number
          updated_at: string
          username: string | null
        }
        Insert: {
          auth_user_id?: string | null
          balance?: number
          ban_reason?: string | null
          banned_at?: string | null
          chat_id: number
          created_at?: string
          first_name?: string | null
          id?: string
          is_banned?: boolean
          pay_later_enabled?: boolean
          pay_later_limit?: number
          pay_later_used?: number
          pending_action?: string | null
          pending_inputs?: Json | null
          referral_balance?: number
          referral_total_earned?: number
          referral_transferred?: number
          updated_at?: string
          username?: string | null
        }
        Update: {
          auth_user_id?: string | null
          balance?: number
          ban_reason?: string | null
          banned_at?: string | null
          chat_id?: number
          created_at?: string
          first_name?: string | null
          id?: string
          is_banned?: boolean
          pay_later_enabled?: boolean
          pay_later_limit?: number
          pay_later_used?: number
          pending_action?: string | null
          pending_inputs?: Json | null
          referral_balance?: number
          referral_total_earned?: number
          referral_transferred?: number
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      bot_deposits: {
        Row: {
          amount: number
          created_at: string
          customer_id: string
          id: string
          payment_method: string | null
          pending_product_id: string | null
          pending_quantity: number | null
          source: string
          status: string
          txn_hash: string | null
          verified_at: string | null
          via: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          customer_id: string
          id?: string
          payment_method?: string | null
          pending_product_id?: string | null
          pending_quantity?: number | null
          source?: string
          status?: string
          txn_hash?: string | null
          verified_at?: string | null
          via?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          customer_id?: string
          id?: string
          payment_method?: string | null
          pending_product_id?: string | null
          pending_quantity?: number | null
          source?: string
          status?: string
          txn_hash?: string | null
          verified_at?: string | null
          via?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bot_deposits_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "bot_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_deposits_pending_product_id_fkey"
            columns: ["pending_product_id"]
            isOneToOne: false
            referencedRelation: "bot_products"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_flash_sales: {
        Row: {
          announcement_messages: Json
          broadcast_attempted: boolean
          created_at: string
          ends_at: string
          id: string
          is_active: boolean
          pending_delete: boolean
          product_id: string
          sale_price: number
          starts_at: string
          target_group_ids: number[] | null
          updated_at: string
        }
        Insert: {
          announcement_messages?: Json
          broadcast_attempted?: boolean
          created_at?: string
          ends_at: string
          id?: string
          is_active?: boolean
          pending_delete?: boolean
          product_id: string
          sale_price: number
          starts_at?: string
          target_group_ids?: number[] | null
          updated_at?: string
        }
        Update: {
          announcement_messages?: Json
          broadcast_attempted?: boolean
          created_at?: string
          ends_at?: string
          id?: string
          is_active?: boolean
          pending_delete?: boolean
          product_id?: string
          sale_price?: number
          starts_at?: string
          target_group_ids?: number[] | null
          updated_at?: string
        }
        Relationships: []
      }
      bot_keyword_triggers: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          keyword: string
          product_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          keyword: string
          product_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          keyword?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_keyword_triggers_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "bot_products"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_notification_settings: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          info_alerts: boolean
          referral_bonus: boolean
          stock_alerts: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          info_alerts?: boolean
          referral_bonus?: boolean
          stock_alerts?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          info_alerts?: boolean
          referral_bonus?: boolean
          stock_alerts?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_notification_settings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "bot_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_orders: {
        Row: {
          created_at: string
          customer_id: string
          customer_inputs: Json | null
          delivered_at: string | null
          delivered_items: Json
          delivery_message_ids: number[]
          delivery_notes: Json
          details: Json | null
          id: string
          payment_method: string | null
          product_id: string
          product_name: string
          quantity: number
          refund_note: string | null
          refunded_at: string | null
          row_numbers: number[] | null
          source: string
          status: string
          total_price: number
          txn_hash: string | null
        }
        Insert: {
          created_at?: string
          customer_id: string
          customer_inputs?: Json | null
          delivered_at?: string | null
          delivered_items?: Json
          delivery_message_ids?: number[]
          delivery_notes?: Json
          details?: Json | null
          id?: string
          payment_method?: string | null
          product_id: string
          product_name: string
          quantity: number
          refund_note?: string | null
          refunded_at?: string | null
          row_numbers?: number[] | null
          source?: string
          status?: string
          total_price: number
          txn_hash?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string
          customer_inputs?: Json | null
          delivered_at?: string | null
          delivered_items?: Json
          delivery_message_ids?: number[]
          delivery_notes?: Json
          details?: Json | null
          id?: string
          payment_method?: string | null
          product_id?: string
          product_name?: string
          quantity?: number
          refund_note?: string | null
          refunded_at?: string | null
          row_numbers?: number[] | null
          source?: string
          status?: string
          total_price?: number
          txn_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bot_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "bot_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_orders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "bot_products"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_payment_methods: {
        Row: {
          created_at: string
          custom_emoji_id: string | null
          emoji: string
          id: string
          instruction: string | null
          is_active: boolean
          name: string
          payment_details: string
          payment_type: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          custom_emoji_id?: string | null
          emoji?: string
          id?: string
          instruction?: string | null
          is_active?: boolean
          name: string
          payment_details: string
          payment_type?: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          custom_emoji_id?: string | null
          emoji?: string
          id?: string
          instruction?: string | null
          is_active?: boolean
          name?: string
          payment_details?: string
          payment_type?: string
          sort_order?: number
        }
        Relationships: []
      }
      bot_product_pricing: {
        Row: {
          created_at: string
          id: string
          max_quantity: number | null
          min_quantity: number
          price: number
          product_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          max_quantity?: number | null
          min_quantity?: number
          price?: number
          product_id: string
        }
        Update: {
          created_at?: string
          id?: string
          max_quantity?: number | null
          min_quantity?: number
          price?: number
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_product_pricing_product_fk"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "bot_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_product_pricing_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "bot_products"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_product_sources: {
        Row: {
          api_key: string
          auth_header: string
          auth_prefix: string
          base_url: string
          created_at: string
          id: string
          is_active: boolean
          kind: string
          last_balance: number | null
          last_checked_at: string | null
          name: string
          updated_at: string
        }
        Insert: {
          api_key: string
          auth_header?: string
          auth_prefix?: string
          base_url: string
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          last_balance?: number | null
          last_checked_at?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          api_key?: string
          auth_header?: string
          auth_prefix?: string
          base_url?: string
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          last_balance?: number | null
          last_checked_at?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      bot_product_stock_items: {
        Row: {
          created_at: string
          data: Json
          id: string
          invalid_reason: string | null
          invalidated_at: string | null
          invalidated_job_id: string | null
          product_id: string
          sold_at: string | null
          sold_order_id: string | null
          sort_index: number
          status: string
          stock_fingerprint: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          data?: Json
          id?: string
          invalid_reason?: string | null
          invalidated_at?: string | null
          invalidated_job_id?: string | null
          product_id: string
          sold_at?: string | null
          sold_order_id?: string | null
          sort_index?: number
          status?: string
          stock_fingerprint?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          invalid_reason?: string | null
          invalidated_at?: string | null
          invalidated_job_id?: string | null
          product_id?: string
          sold_at?: string | null
          sold_order_id?: string | null
          sort_index?: number
          status?: string
          stock_fingerprint?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      bot_products: {
        Row: {
          created_at: string
          currency: string
          custom_emoji_id: string | null
          customer_input_fields: Json
          delivery_instruction: string | null
          delivery_media: Json | null
          description: string | null
          detail_columns: string[]
          id: string
          is_active: boolean
          is_manual_delivery: boolean
          last_known_stock: number
          link_check_auto: boolean
          name: string
          price: number
          sheet_gid: number | null
          sheet_tab: string
          short_code: string | null
          sold_column: string
          sold_value: string
          sort_order: number
          source_id: string | null
          source_price: number | null
          source_product_id: string | null
          stock_source: string
        }
        Insert: {
          created_at?: string
          currency?: string
          custom_emoji_id?: string | null
          customer_input_fields?: Json
          delivery_instruction?: string | null
          delivery_media?: Json | null
          description?: string | null
          detail_columns?: string[]
          id?: string
          is_active?: boolean
          is_manual_delivery?: boolean
          last_known_stock?: number
          link_check_auto?: boolean
          name: string
          price?: number
          sheet_gid?: number | null
          sheet_tab: string
          short_code?: string | null
          sold_column?: string
          sold_value?: string
          sort_order?: number
          source_id?: string | null
          source_price?: number | null
          source_product_id?: string | null
          stock_source?: string
        }
        Update: {
          created_at?: string
          currency?: string
          custom_emoji_id?: string | null
          customer_input_fields?: Json
          delivery_instruction?: string | null
          delivery_media?: Json | null
          description?: string | null
          detail_columns?: string[]
          id?: string
          is_active?: boolean
          is_manual_delivery?: boolean
          last_known_stock?: number
          link_check_auto?: boolean
          name?: string
          price?: number
          sheet_gid?: number | null
          sheet_tab?: string
          short_code?: string | null
          sold_column?: string
          sold_value?: string
          sort_order?: number
          source_id?: string | null
          source_price?: number | null
          source_product_id?: string | null
          stock_source?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_products_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "bot_product_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_referral_earnings: {
        Row: {
          amount: number
          created_at: string
          id: string
          referred_id: string
          referrer_id: string
          source_order_id: string | null
          type: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          referred_id: string
          referrer_id: string
          source_order_id?: string | null
          type?: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          referred_id?: string
          referrer_id?: string
          source_order_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_referral_earnings_referred_id_fkey"
            columns: ["referred_id"]
            isOneToOne: false
            referencedRelation: "bot_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_referral_earnings_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "bot_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_referral_earnings_source_order_id_fkey"
            columns: ["source_order_id"]
            isOneToOne: false
            referencedRelation: "bot_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_referrals: {
        Row: {
          created_at: string
          first_bonus_paid: boolean
          id: string
          referred_id: string
          referrer_id: string
        }
        Insert: {
          created_at?: string
          first_bonus_paid?: boolean
          id?: string
          referred_id: string
          referrer_id: string
        }
        Update: {
          created_at?: string
          first_bonus_paid?: boolean
          id?: string
          referred_id?: string
          referrer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_referrals_referred_id_fkey"
            columns: ["referred_id"]
            isOneToOne: true
            referencedRelation: "bot_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_referrals_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "bot_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_reseller_balance_transactions: {
        Row: {
          amount: number
          balance_after: number
          created_at: string
          id: string
          note: string | null
          order_id: string | null
          reseller_id: string
          type: string
        }
        Insert: {
          amount: number
          balance_after: number
          created_at?: string
          id?: string
          note?: string | null
          order_id?: string | null
          reseller_id: string
          type: string
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string
          id?: string
          note?: string | null
          order_id?: string | null
          reseller_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_reseller_balance_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "bot_reseller_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_reseller_balance_transactions_reseller_id_fkey"
            columns: ["reseller_id"]
            isOneToOne: false
            referencedRelation: "bot_resellers"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_reseller_orders: {
        Row: {
          created_at: string
          details: Json
          external_order_id: string | null
          id: string
          product_id: string
          product_name: string
          quantity: number
          reseller_id: string
          status: string
          total_cost: number
          unit_cost: number
        }
        Insert: {
          created_at?: string
          details?: Json
          external_order_id?: string | null
          id?: string
          product_id: string
          product_name: string
          quantity: number
          reseller_id: string
          status?: string
          total_cost: number
          unit_cost: number
        }
        Update: {
          created_at?: string
          details?: Json
          external_order_id?: string | null
          id?: string
          product_id?: string
          product_name?: string
          quantity?: number
          reseller_id?: string
          status?: string
          total_cost?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "bot_reseller_orders_reseller_id_fkey"
            columns: ["reseller_id"]
            isOneToOne: false
            referencedRelation: "bot_resellers"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_resellers: {
        Row: {
          api_key_encrypted: string | null
          api_key_hash: string
          api_key_prefix: string
          balance: number
          created_at: string
          customer_id: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          api_key_encrypted?: string | null
          api_key_hash: string
          api_key_prefix: string
          balance?: number
          created_at?: string
          customer_id?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          api_key_encrypted?: string | null
          api_key_hash?: string
          api_key_prefix?: string
          balance?: number
          created_at?: string
          customer_id?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      bot_settings: {
        Row: {
          created_at: string
          id: string
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          updated_at?: string
          value?: string
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      bot_telegram_bind_codes: {
        Row: {
          auth_user_id: string
          code: string
          created_at: string
          expires_at: string
          used_at: string | null
        }
        Insert: {
          auth_user_id: string
          code: string
          created_at?: string
          expires_at?: string
          used_at?: string | null
        }
        Update: {
          auth_user_id?: string
          code?: string
          created_at?: string
          expires_at?: string
          used_at?: string | null
        }
        Relationships: []
      }
      bot_withdrawals: {
        Row: {
          admin_note: string | null
          amount: number
          asset: string | null
          auto_attempted: boolean
          binance_withdraw_id: string | null
          created_at: string
          customer_id: string
          error_message: string | null
          id: string
          network: string | null
          payment_details: string
          processed_at: string | null
          proof_url: string | null
          status: string
          txn_hash: string | null
        }
        Insert: {
          admin_note?: string | null
          amount: number
          asset?: string | null
          auto_attempted?: boolean
          binance_withdraw_id?: string | null
          created_at?: string
          customer_id: string
          error_message?: string | null
          id?: string
          network?: string | null
          payment_details: string
          processed_at?: string | null
          proof_url?: string | null
          status?: string
          txn_hash?: string | null
        }
        Update: {
          admin_note?: string | null
          amount?: number
          asset?: string | null
          auto_attempted?: boolean
          binance_withdraw_id?: string | null
          created_at?: string
          customer_id?: string
          error_message?: string | null
          id?: string
          network?: string | null
          payment_details?: string
          processed_at?: string | null
          proof_url?: string | null
          status?: string
          txn_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bot_withdrawals_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "bot_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_announcement_reads: {
        Row: {
          announcement_id: string
          customer_id: string
          id: string
          read_at: string
        }
        Insert: {
          announcement_id: string
          customer_id: string
          id?: string
          read_at?: string
        }
        Update: {
          announcement_id?: string
          customer_id?: string
          id?: string
          read_at?: string
        }
        Relationships: []
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
      google_account_cookies: {
        Row: {
          cookies_json: Json
          created_at: string
          expired: boolean
          id: string
          is_active: boolean
          label: string
          last_verified_at: string | null
          updated_at: string
        }
        Insert: {
          cookies_json: Json
          created_at?: string
          expired?: boolean
          id?: string
          is_active?: boolean
          label: string
          last_verified_at?: string | null
          updated_at?: string
        }
        Update: {
          cookies_json?: Json
          created_at?: string
          expired?: boolean
          id?: string
          is_active?: boolean
          label?: string
          last_verified_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      link_check_items: {
        Row: {
          checked_at: string | null
          created_at: string
          id: string
          job_id: string
          reason: string | null
          status: string
          stock_item_id: string | null
          url: string
        }
        Insert: {
          checked_at?: string | null
          created_at?: string
          id?: string
          job_id: string
          reason?: string | null
          status?: string
          stock_item_id?: string | null
          url: string
        }
        Update: {
          checked_at?: string | null
          created_at?: string
          id?: string
          job_id?: string
          reason?: string | null
          status?: string
          stock_item_id?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "link_check_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "link_check_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "link_check_items_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "bot_product_stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      link_check_jobs: {
        Row: {
          checked: number
          concurrency: number
          cookie_id: string | null
          created_at: string
          delay_ms: number
          error_count: number
          error_text: string | null
          finished_at: string | null
          id: string
          invalid_count: number
          product_id: string
          started_at: string | null
          status: string
          total: number
          updated_at: string
          valid_count: number
        }
        Insert: {
          checked?: number
          concurrency?: number
          cookie_id?: string | null
          created_at?: string
          delay_ms?: number
          error_count?: number
          error_text?: string | null
          finished_at?: string | null
          id?: string
          invalid_count?: number
          product_id: string
          started_at?: string | null
          status?: string
          total?: number
          updated_at?: string
          valid_count?: number
        }
        Update: {
          checked?: number
          concurrency?: number
          cookie_id?: string | null
          created_at?: string
          delay_ms?: number
          error_count?: number
          error_text?: string | null
          finished_at?: string | null
          id?: string
          invalid_count?: number
          product_id?: string
          started_at?: string | null
          status?: string
          total?: number
          updated_at?: string
          valid_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "link_check_jobs_cookie_id_fkey"
            columns: ["cookie_id"]
            isOneToOne: false
            referencedRelation: "google_account_cookies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "link_check_jobs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "bot_products"
            referencedColumns: ["id"]
          },
        ]
      }
      site_announcements: {
        Row: {
          body: string | null
          body_html: string | null
          created_at: string
          expires_at: string | null
          id: string
          is_active: boolean
          link_url: string | null
          media_type: string | null
          media_url: string | null
          severity: string
          show_as_banner: boolean
          title: string
        }
        Insert: {
          body?: string | null
          body_html?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          link_url?: string | null
          media_type?: string | null
          media_url?: string | null
          severity?: string
          show_as_banner?: boolean
          title: string
        }
        Update: {
          body?: string | null
          body_html?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          link_url?: string | null
          media_type?: string | null
          media_url?: string | null
          severity?: string
          show_as_banner?: boolean
          title?: string
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
      sync_watermarks: {
        Row: {
          last_error: string | null
          last_run_at: string | null
          last_status: string | null
          last_value: string
          rows_synced_total: number
          table_name: string
          updated_at: string
          watermark_column: string
        }
        Insert: {
          last_error?: string | null
          last_run_at?: string | null
          last_status?: string | null
          last_value?: string
          rows_synced_total?: number
          table_name: string
          updated_at?: string
          watermark_column: string
        }
        Update: {
          last_error?: string | null
          last_run_at?: string | null
          last_status?: string | null
          last_value?: string
          rows_synced_total?: number
          table_name?: string
          updated_at?: string
          watermark_column?: string
        }
        Relationships: []
      }
      telegram_bot_state: {
        Row: {
          id: number
          update_offset: number
          updated_at: string
        }
        Insert: {
          id: number
          update_offset?: number
          updated_at?: string
        }
        Update: {
          id?: number
          update_offset?: number
          updated_at?: string
        }
        Relationships: []
      }
      user_channel_verification: {
        Row: {
          user_id: number
          verified_at: string
        }
        Insert: {
          user_id: number
          verified_at?: string
        }
        Update: {
          user_id?: number
          verified_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      bind_telegram_to_customer: {
        Args: {
          _auth_user_id: string
          _chat_id: number
          _first_name: string
          _username: string
        }
        Returns: {
          message: string
          status: string
        }[]
      }
      claim_next_link_check_item: {
        Args: { _job_id: string }
        Returns: {
          id: string
          stock_item_id: string
          url: string
        }[]
      }
      claim_pending_delivery_order: {
        Args: { _new_status: string; _order_id: string }
        Returns: {
          claimed: boolean
          customer_id: string
          payment_method: string
          product_name: string
          quantity: number
          total_price: number
        }[]
      }
      current_customer_id: { Args: never; Returns: string }
      deduct_customer_balance: {
        Args: { _amount: number; _customer_id: string }
        Returns: {
          new_balance: number
          success: boolean
        }[]
      }
      deduct_pay_later_credit: {
        Args: { _amount: number; _customer_id: string }
        Returns: {
          limit_amount: number
          new_used: number
          success: boolean
        }[]
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      get_bot_quick_stats: {
        Args: { _month: string; _today: string; _week: string }
        Returns: Json
      }
      get_product_stock_counts: {
        Args: { _product_ids: string[] }
        Returns: {
          available_count: number
          product_id: string
        }[]
      }
      get_product_stock_items: {
        Args: { _product_id: string }
        Returns: {
          created_at: string
          data: Json
          id: string
          sold_at: string
          sort_index: number
          status: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      mark_link_check_result: {
        Args: { _item_id: string; _reason: string; _result: string }
        Returns: undefined
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
      place_reseller_api_order: {
        Args: {
          _api_key_hash: string
          _external_order_id?: string
          _product_id: string
          _quantity: number
        }
        Returns: {
          balance_after: number
          customer_chat_id: number
          customer_first_name: string
          customer_id: string
          customer_username: string
          details: Json
          order_id: string
          product_id: string
          product_name: string
          quantity: number
          total_cost: number
          unit_cost: number
        }[]
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      refund_customer_balance: {
        Args: { _amount: number; _customer_id: string }
        Returns: {
          new_balance: number
          success: boolean
        }[]
      }
      refund_pay_later_credit: {
        Args: { _amount: number; _customer_id: string }
        Returns: {
          limit_amount: number
          new_used: number
          success: boolean
        }[]
      }
      reserve_internal_stock_items: {
        Args: { _order_id?: string; _product_id: string; _quantity: number }
        Returns: {
          data: Json
          id: string
        }[]
      }
      restore_internal_stock_items: {
        Args: { _order_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "customer"
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
      app_role: ["admin", "customer"],
    },
  },
} as const
