--
-- PostgreSQL database dump
--

\restrict rdHgs1dmBlBlSlVAG359V54gxsezO1bMuShMPkSteD6FbARWtpW46wpugqnXo36

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: andon_category; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.andon_category AS ENUM (
    'equipment',
    'safety',
    'production',
    'product',
    'other'
);


--
-- Name: andon_severity; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.andon_severity AS ENUM (
    'yellow',
    'red'
);


--
-- Name: improvement_approval_tier; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.improvement_approval_tier AS ENUM (
    'minor',
    'medium',
    'major'
);


--
-- Name: improvement_progress_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.improvement_progress_status AS ENUM (
    'submitted_for_review',
    'approved',
    'testing',
    'complete',
    'rejected',
    'acknowledged'
);


--
-- Name: storage_zone; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.storage_zone AS ENUM (
    'fridge',
    'freezer',
    'ambient'
);


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'admin',
    'manager',
    'viewer'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _migrations_done; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._migrations_done (
    key text NOT NULL,
    done_at timestamp without time zone DEFAULT now()
);


--
-- Name: andon_issues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.andon_issues (
    id integer NOT NULL,
    category public.andon_category NOT NULL,
    severity public.andon_severity NOT NULL,
    description text,
    station text NOT NULL,
    reported_by integer,
    reported_by_name text,
    acknowledged_by integer,
    acknowledged_by_name text,
    acknowledged_at timestamp without time zone,
    resolved_by integer,
    resolved_by_name text,
    resolved_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: andon_issues_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.andon_issues_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: andon_issues_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.andon_issues_id_seq OWNED BY public.andon_issues.id;


--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_settings (
    id integer NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: app_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: app_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.app_settings_id_seq OWNED BY public.app_settings.id;


--
-- Name: app_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_users (
    id integer NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    role public.user_role DEFAULT 'viewer'::public.user_role NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    pin_hash text,
    pin_attempts integer DEFAULT 0 NOT NULL,
    pin_locked_until timestamp without time zone,
    avatar_url text
);


--
-- Name: app_users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: app_users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.app_users_id_seq OWNED BY public.app_users.id;


--
-- Name: batch_completions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.batch_completions (
    id integer NOT NULL,
    plan_item_id integer NOT NULL,
    station_type text NOT NULL,
    user_id integer,
    started_at timestamp without time zone,
    completed_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: batch_completions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.batch_completions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: batch_completions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.batch_completions_id_seq OWNED BY public.batch_completions.id;


--
-- Name: category_defaults; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.category_defaults (
    id integer NOT NULL,
    category text NOT NULL,
    default_packaging_cost numeric(10,4) DEFAULT 0 NOT NULL,
    default_labour_cost numeric(10,4) DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    default_pack_size integer DEFAULT 1 NOT NULL
);


--
-- Name: category_defaults_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.category_defaults_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: category_defaults_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.category_defaults_id_seq OWNED BY public.category_defaults.id;


--
-- Name: daily_stock_checks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_stock_checks (
    id integer NOT NULL,
    ingredient_id integer NOT NULL,
    check_date date NOT NULL,
    quantity numeric(10,4),
    user_id integer,
    checked_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: daily_stock_checks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.daily_stock_checks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: daily_stock_checks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.daily_stock_checks_id_seq OWNED BY public.daily_stock_checks.id;


--
-- Name: delivery_check_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_check_configs (
    id integer NOT NULL,
    supplier_id integer NOT NULL,
    label text NOT NULL,
    is_required boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL
);


--
-- Name: delivery_check_configs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.delivery_check_configs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: delivery_check_configs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.delivery_check_configs_id_seq OWNED BY public.delivery_check_configs.id;


--
-- Name: delivery_check_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_check_results (
    id integer NOT NULL,
    delivery_record_id integer NOT NULL,
    check_config_id integer NOT NULL,
    passed boolean DEFAULT false NOT NULL,
    notes text
);


--
-- Name: delivery_check_results_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.delivery_check_results_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: delivery_check_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.delivery_check_results_id_seq OWNED BY public.delivery_check_results.id;


--
-- Name: delivery_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_records (
    id integer NOT NULL,
    purchase_order_id integer,
    supplier_id integer NOT NULL,
    received_at timestamp without time zone DEFAULT now() NOT NULL,
    received_by_user_id integer,
    chilled_temp_c numeric(5,1),
    frozen_temp_c numeric(5,1),
    invoice_filed boolean DEFAULT false NOT NULL,
    all_put_away boolean DEFAULT false NOT NULL,
    kanbans_replaced boolean DEFAULT false NOT NULL,
    notes text
);


--
-- Name: delivery_records_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.delivery_records_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: delivery_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.delivery_records_id_seq OWNED BY public.delivery_records.id;


--
-- Name: dispatch_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dispatch_orders (
    id integer NOT NULL,
    recipe_id integer NOT NULL,
    dispatch_date date NOT NULL,
    quantity numeric(10,4) NOT NULL,
    customer text,
    status text DEFAULT 'pending'::text NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    fulfilled_at timestamp without time zone
);


--
-- Name: dispatch_orders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dispatch_orders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dispatch_orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dispatch_orders_id_seq OWNED BY public.dispatch_orders.id;


--
-- Name: dpt_ingredient_requirements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dpt_ingredient_requirements (
    id integer NOT NULL,
    ingredient_id integer NOT NULL,
    daily_qty_raw numeric(10,4) DEFAULT 0 NOT NULL,
    daily_qty_cooked numeric(10,4) DEFAULT 0 NOT NULL,
    unit text NOT NULL,
    calculated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: dpt_ingredient_requirements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dpt_ingredient_requirements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dpt_ingredient_requirements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dpt_ingredient_requirements_id_seq OWNED BY public.dpt_ingredient_requirements.id;


--
-- Name: dpt_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dpt_settings (
    id integer NOT NULL,
    recipe_id integer NOT NULL,
    default_batches_per_day numeric(10,2) DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    surplus_percent numeric(5,2) DEFAULT 20 NOT NULL,
    packs_sold integer DEFAULT 0 NOT NULL
);


--
-- Name: dpt_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dpt_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dpt_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dpt_settings_id_seq OWNED BY public.dpt_settings.id;


--
-- Name: founder_custom_panels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.founder_custom_panels (
    id integer NOT NULL,
    tag text NOT NULL,
    label text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: founder_custom_panels_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.founder_custom_panels_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: founder_custom_panels_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.founder_custom_panels_id_seq OWNED BY public.founder_custom_panels.id;


--
-- Name: improvement_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.improvement_submissions (
    id integer NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    station text NOT NULL,
    submitted_by integer,
    submitted_by_name text,
    approval_tier public.improvement_approval_tier,
    progress_status public.improvement_progress_status DEFAULT 'submitted_for_review'::public.improvement_progress_status NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    type text DEFAULT 'improvement'::text NOT NULL
);


--
-- Name: improvement_submissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.improvement_submissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: improvement_submissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.improvement_submissions_id_seq OWNED BY public.improvement_submissions.id;


--
-- Name: ingredient_storage_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ingredient_storage_locations (
    id integer NOT NULL,
    ingredient_id integer NOT NULL,
    location_id integer NOT NULL,
    rack_label text,
    shelf_label text
);


--
-- Name: ingredient_storage_locations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ingredient_storage_locations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ingredient_storage_locations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ingredient_storage_locations_id_seq OWNED BY public.ingredient_storage_locations.id;


--
-- Name: ingredients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ingredients (
    id integer NOT NULL,
    name text NOT NULL,
    unit text NOT NULL,
    cost_per_pack numeric(10,4) DEFAULT '0'::numeric NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    pack_weight numeric(10,4) DEFAULT 0 NOT NULL,
    brand text,
    supplier_part_number text,
    supplier_id integer,
    secondary_supplier_id integer,
    ordering_url text,
    processing_ratio numeric(5,4),
    raw_meat_tray_capacity_kg numeric(10,4),
    category text,
    stock_check_enabled boolean DEFAULT false NOT NULL,
    stock_check_frequency text DEFAULT 'daily'::text NOT NULL,
    stock_check_day text,
    min_cooking_temp_c numeric(5,2),
    estimated_cook_time_min integer,
    oven_temp_c integer,
    steam_pct integer,
    surplus_percent numeric(8,2) DEFAULT 10 NOT NULL,
    shelf_life_days integer,
    kanban_enabled boolean DEFAULT false NOT NULL,
    kanban_quantity numeric(10,4) DEFAULT 0 NOT NULL,
    kanban_unit text DEFAULT 'weight'::text NOT NULL,
    kanban_order_amount numeric(10,4),
    perishable boolean DEFAULT true NOT NULL,
    pallet_size integer,
    energy_kj numeric(10,2),
    energy_kcal numeric(10,2),
    fat numeric(10,2),
    saturates numeric(10,2),
    carbohydrate numeric(10,2),
    sugars numeric(10,2),
    protein numeric(10,2),
    salt numeric(10,2),
    label_declaration text,
    allergens jsonb DEFAULT '[]'::jsonb,
    fibre numeric(10,2),
    prep_weight_mode text DEFAULT 'raw'::text NOT NULL,
    qr_code_url text,
    is_bottle boolean DEFAULT false NOT NULL,
    bottle_size numeric(10,4),
    CONSTRAINT ingredients_processing_ratio_check CHECK (((processing_ratio >= (0)::numeric) AND (processing_ratio <= (1)::numeric)))
);


--
-- Name: ingredients_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ingredients_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ingredients_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ingredients_id_seq OWNED BY public.ingredients.id;


--
-- Name: kanban_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kanban_items (
    id integer NOT NULL,
    ingredient_id integer,
    supplier_id integer,
    status text DEFAULT 'active'::text NOT NULL,
    pulled_at timestamp without time zone,
    pulled_by_user_id integer,
    order_day_target date,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    source_type text DEFAULT 'ingredient'::text NOT NULL,
    recipe_id integer,
    sub_recipe_id integer,
    qr_code_url text,
    CONSTRAINT kanban_items_source_type_check CHECK ((source_type = ANY (ARRAY['ingredient'::text, 'recipe'::text, 'sub_recipe'::text])))
);


--
-- Name: kanban_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.kanban_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: kanban_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.kanban_items_id_seq OWNED BY public.kanban_items.id;


--
-- Name: oven_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oven_events (
    id integer NOT NULL,
    plan_id integer NOT NULL,
    recipe_id integer,
    recipe_name text,
    ingredient_id integer,
    ingredient_name text,
    tray_index integer NOT NULL,
    oven_in_at timestamp without time zone DEFAULT now() NOT NULL,
    oven_out_at timestamp without time zone,
    user_id integer,
    user_name text
);


--
-- Name: oven_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.oven_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: oven_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.oven_events_id_seq OWNED BY public.oven_events.id;


--
-- Name: page_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.page_permissions (
    page_key text NOT NULL,
    min_role public.user_role DEFAULT 'viewer'::public.user_role NOT NULL
);


--
-- Name: password_resets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_resets (
    id integer NOT NULL,
    token text NOT NULL,
    user_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    used_at timestamp without time zone
);


--
-- Name: password_resets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.password_resets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: password_resets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.password_resets_id_seq OWNED BY public.password_resets.id;


--
-- Name: postcode_validations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.postcode_validations (
    id integer NOT NULL,
    shopify_order_id bigint NOT NULL,
    postcode text NOT NULL,
    service_code text NOT NULL,
    available boolean NOT NULL,
    reason text,
    checked_at timestamp without time zone DEFAULT now() NOT NULL,
    dispatch_tag text
);


--
-- Name: postcode_validations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.postcode_validations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: postcode_validations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.postcode_validations_id_seq OWNED BY public.postcode_validations.id;


--
-- Name: prep_completions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prep_completions (
    id integer NOT NULL,
    plan_id integer NOT NULL,
    ingredient_id integer,
    recipe_id integer NOT NULL,
    tin_number integer NOT NULL,
    user_id integer,
    completed_at timestamp without time zone DEFAULT now() NOT NULL,
    sub_recipe_id integer
);


--
-- Name: prep_completions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.prep_completions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: prep_completions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.prep_completions_id_seq OWNED BY public.prep_completions.id;


--
-- Name: production_plan_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.production_plan_items (
    id integer NOT NULL,
    plan_id integer NOT NULL,
    recipe_id integer NOT NULL,
    notes text,
    status text DEFAULT 'pending'::text NOT NULL,
    order_position integer DEFAULT 0 NOT NULL,
    batches_target integer DEFAULT 0 NOT NULL,
    batches_complete integer DEFAULT 0 NOT NULL,
    wonly_count integer DEFAULT 0 NOT NULL,
    tin_size text,
    max_batches_per_tin integer,
    sop_url text,
    wrapping_complete boolean DEFAULT false NOT NULL,
    fridge_qty integer DEFAULT 0 NOT NULL,
    freezer_qty integer DEFAULT 0 NOT NULL,
    prep_fridge_qty integer DEFAULT 0 NOT NULL,
    extra_packs_built integer DEFAULT 0 NOT NULL,
    short_count integer DEFAULT 0 NOT NULL
);


--
-- Name: production_plan_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.production_plan_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: production_plan_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.production_plan_items_id_seq OWNED BY public.production_plan_items.id;


--
-- Name: production_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.production_plans (
    id integer NOT NULL,
    plan_date date NOT NULL,
    name text NOT NULL,
    notes text,
    status text DEFAULT 'draft'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    batch_number integer
);


--
-- Name: production_plans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.production_plans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: production_plans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.production_plans_id_seq OWNED BY public.production_plans.id;


--
-- Name: purchase_order_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_order_lines (
    id integer NOT NULL,
    purchase_order_id integer NOT NULL,
    ingredient_id integer NOT NULL,
    quantity_required numeric(10,4) DEFAULT 0 NOT NULL,
    quantity_ordered numeric(10,4) DEFAULT 0 NOT NULL,
    quantity_received numeric(10,4) DEFAULT 0 NOT NULL,
    unit text NOT NULL,
    unit_price numeric(10,4),
    checked_off boolean DEFAULT false NOT NULL,
    notes text,
    use_by_date date
);


--
-- Name: purchase_order_lines_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.purchase_order_lines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: purchase_order_lines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.purchase_order_lines_id_seq OWNED BY public.purchase_order_lines.id;


--
-- Name: purchase_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_orders (
    id integer NOT NULL,
    supplier_id integer NOT NULL,
    plan_id integer,
    status text DEFAULT 'draft'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    placed_at timestamp without time zone,
    expected_delivery_date date,
    notes text,
    placed_by_user_id integer
);


--
-- Name: purchase_orders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.purchase_orders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: purchase_orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.purchase_orders_id_seq OWNED BY public.purchase_orders.id;


--
-- Name: recipe_ingredients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recipe_ingredients (
    id integer NOT NULL,
    recipe_id integer NOT NULL,
    ingredient_id integer NOT NULL,
    quantity numeric(10,4) NOT NULL,
    marinade_for_ingredient_id integer,
    include_in_filling_mix boolean DEFAULT false NOT NULL,
    quid boolean DEFAULT false NOT NULL,
    is_topping boolean DEFAULT false NOT NULL,
    assembly_order integer
);


--
-- Name: recipe_ingredients_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.recipe_ingredients_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: recipe_ingredients_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.recipe_ingredients_id_seq OWNED BY public.recipe_ingredients.id;


--
-- Name: recipe_meat_marinades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recipe_meat_marinades (
    id integer NOT NULL,
    recipe_id integer NOT NULL,
    raw_meat_ingredient_id integer NOT NULL,
    marinade_ingredient_id integer,
    marinade_sub_recipe_id integer,
    grams_per_kg numeric(10,4) NOT NULL,
    CONSTRAINT grams_per_kg_positive CHECK ((grams_per_kg > (0)::numeric)),
    CONSTRAINT marinade_xor CHECK ((((marinade_ingredient_id IS NOT NULL) AND (marinade_sub_recipe_id IS NULL)) OR ((marinade_ingredient_id IS NULL) AND (marinade_sub_recipe_id IS NOT NULL))))
);


--
-- Name: recipe_meat_marinades_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.recipe_meat_marinades_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: recipe_meat_marinades_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.recipe_meat_marinades_id_seq OWNED BY public.recipe_meat_marinades.id;


--
-- Name: recipe_shopify_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recipe_shopify_mappings (
    id integer NOT NULL,
    recipe_id integer NOT NULL,
    shopify_variant_id text NOT NULL,
    shopify_product_title text,
    shopify_variant_title text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    wonky_variant_id text,
    wonky_product_title text,
    wonky_variant_title text
);


--
-- Name: recipe_shopify_mappings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.recipe_shopify_mappings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: recipe_shopify_mappings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.recipe_shopify_mappings_id_seq OWNED BY public.recipe_shopify_mappings.id;


--
-- Name: recipe_sub_recipes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recipe_sub_recipes (
    id integer NOT NULL,
    recipe_id integer NOT NULL,
    sub_recipe_id integer NOT NULL,
    quantity numeric(10,4) NOT NULL,
    marinade_for_ingredient_id integer,
    include_in_filling_mix boolean DEFAULT false NOT NULL,
    quid boolean DEFAULT false NOT NULL,
    is_topping boolean DEFAULT false NOT NULL,
    assembly_order integer
);


--
-- Name: recipe_sub_recipes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.recipe_sub_recipes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: recipe_sub_recipes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.recipe_sub_recipes_id_seq OWNED BY public.recipe_sub_recipes.id;


--
-- Name: recipes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recipes (
    id integer NOT NULL,
    name text NOT NULL,
    description text,
    servings numeric(10,4) NOT NULL,
    serving_unit text NOT NULL,
    category text,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    pack_size numeric(10,4) DEFAULT 1 NOT NULL,
    rrp numeric(10,4) DEFAULT 0 NOT NULL,
    packaging_cost numeric(10,4) DEFAULT 0 NOT NULL,
    labour_cost numeric(10,4) DEFAULT 0 NOT NULL,
    portions_per_batch integer DEFAULT 10 NOT NULL,
    shelf_life_days integer,
    tin_size text,
    max_batches_per_tin integer,
    sop_url text,
    fill_weight_grams numeric(10,2),
    base_type text,
    base_weight_grams numeric(10,2),
    is_core_menu boolean DEFAULT false NOT NULL,
    color text,
    is_current_special boolean DEFAULT false NOT NULL,
    cooking_loss_percent numeric(5,2) DEFAULT 3 NOT NULL
);


--
-- Name: recipes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.recipes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: recipes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.recipes_id_seq OWNED BY public.recipes.id;


--
-- Name: sales_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_entries (
    id integer NOT NULL,
    recipe_id integer NOT NULL,
    sale_date date NOT NULL,
    quantity_sold numeric(10,4) NOT NULL,
    channel text,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: sales_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sales_entries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sales_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sales_entries_id_seq OWNED BY public.sales_entries.id;


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    sid character varying NOT NULL,
    sess json NOT NULL,
    expire timestamp(6) without time zone NOT NULL
);


--
-- Name: sku_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sku_locations (
    sku text NOT NULL,
    zone public.storage_zone NOT NULL,
    location_label text NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: station_breaks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.station_breaks (
    id integer NOT NULL,
    plan_id integer NOT NULL,
    station_type text NOT NULL,
    user_id integer,
    break_type text DEFAULT 'morning'::text NOT NULL,
    started_at timestamp without time zone DEFAULT now() NOT NULL,
    ended_at timestamp without time zone
);


--
-- Name: station_breaks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.station_breaks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: station_breaks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.station_breaks_id_seq OWNED BY public.station_breaks.id;


--
-- Name: stock_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_entries (
    id integer NOT NULL,
    recipe_id integer,
    ingredient_id integer,
    item_type text NOT NULL,
    quantity numeric(10,4) NOT NULL,
    unit text NOT NULL,
    checked_at timestamp without time zone DEFAULT now() NOT NULL,
    notes text,
    location text DEFAULT 'production_fridge'::text NOT NULL,
    stock_item_id integer,
    use_by_date date
);


--
-- Name: stock_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.stock_entries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: stock_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.stock_entries_id_seq OWNED BY public.stock_entries.id;


--
-- Name: stock_item_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_item_categories (
    id integer NOT NULL,
    name text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: stock_item_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.stock_item_categories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: stock_item_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.stock_item_categories_id_seq OWNED BY public.stock_item_categories.id;


--
-- Name: stock_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_items (
    id integer NOT NULL,
    name text NOT NULL,
    category text NOT NULL,
    unit text NOT NULL,
    pack_weight numeric(10,4) DEFAULT 0 NOT NULL,
    cost_per_pack numeric(10,4) DEFAULT 0 NOT NULL,
    supplier_id integer,
    secondary_supplier_id integer,
    supplier_part_number text,
    ordering_url text,
    stock_check_enabled boolean DEFAULT false NOT NULL,
    stock_check_frequency text DEFAULT 'daily'::text NOT NULL,
    stock_check_day text,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: stock_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.stock_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: stock_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.stock_items_id_seq OWNED BY public.stock_items.id;


--
-- Name: stock_transfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_transfers (
    id integer NOT NULL,
    ingredient_id integer,
    from_location text NOT NULL,
    to_location text NOT NULL,
    quantity numeric(10,4) NOT NULL,
    unit text NOT NULL,
    transferred_at timestamp without time zone DEFAULT now() NOT NULL,
    user_id integer,
    notes text
);


--
-- Name: stock_transfers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.stock_transfers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: stock_transfers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.stock_transfers_id_seq OWNED BY public.stock_transfers.id;


--
-- Name: storage_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.storage_locations (
    id integer NOT NULL,
    name text NOT NULL,
    zone text DEFAULT 'fridge'::text NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: storage_locations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.storage_locations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: storage_locations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.storage_locations_id_seq OWNED BY public.storage_locations.id;


--
-- Name: storage_racks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.storage_racks (
    id integer NOT NULL,
    location_id integer NOT NULL,
    label text NOT NULL
);


--
-- Name: storage_racks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.storage_racks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: storage_racks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.storage_racks_id_seq OWNED BY public.storage_racks.id;


--
-- Name: sub_recipe_ingredients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sub_recipe_ingredients (
    id integer NOT NULL,
    sub_recipe_id integer NOT NULL,
    ingredient_id integer NOT NULL,
    quantity numeric(10,4) NOT NULL
);


--
-- Name: sub_recipe_ingredients_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sub_recipe_ingredients_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sub_recipe_ingredients_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sub_recipe_ingredients_id_seq OWNED BY public.sub_recipe_ingredients.id;


--
-- Name: sub_recipe_sub_recipes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sub_recipe_sub_recipes (
    id integer NOT NULL,
    sub_recipe_id integer NOT NULL,
    component_sub_recipe_id integer NOT NULL,
    quantity numeric(10,4) NOT NULL
);


--
-- Name: sub_recipe_sub_recipes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sub_recipe_sub_recipes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sub_recipe_sub_recipes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sub_recipe_sub_recipes_id_seq OWNED BY public.sub_recipe_sub_recipes.id;


--
-- Name: sub_recipes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sub_recipes (
    id integer NOT NULL,
    name text NOT NULL,
    description text,
    yield numeric(10,4) NOT NULL,
    yield_unit text NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    shelf_life_days integer,
    is_base boolean DEFAULT false NOT NULL,
    label_declaration text
);


--
-- Name: sub_recipes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sub_recipes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sub_recipes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sub_recipes_id_seq OWNED BY public.sub_recipes.id;


--
-- Name: suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suppliers (
    id integer NOT NULL,
    name text NOT NULL,
    contact_name text,
    email text,
    phone text,
    website text,
    address text,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    order_frequency text DEFAULT 'daily'::text NOT NULL,
    order_days text,
    lead_time_days integer DEFAULT 1 NOT NULL,
    cutoff_time text DEFAULT '17:00'::text NOT NULL
);


--
-- Name: suppliers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.suppliers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: suppliers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.suppliers_id_seq OWNED BY public.suppliers.id;


--
-- Name: temperature_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.temperature_records (
    id integer NOT NULL,
    plan_id integer NOT NULL,
    plan_name text,
    recipe_id integer,
    recipe_name text,
    ingredient_id integer,
    ingredient_name text,
    tray_index integer NOT NULL,
    temperature_c numeric(5,1) NOT NULL,
    record_type text DEFAULT 'cooked_core'::text NOT NULL,
    user_id integer,
    user_name text,
    recorded_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: temperature_records_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.temperature_records_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: temperature_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.temperature_records_id_seq OWNED BY public.temperature_records.id;


--
-- Name: timing_standards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.timing_standards (
    id integer NOT NULL,
    station_type text NOT NULL,
    station_label text NOT NULL,
    min_batches_per_hour numeric(10,2) DEFAULT 0 NOT NULL,
    target_batches_per_hour numeric(10,2) DEFAULT 0 NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: timing_standards_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.timing_standards_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: timing_standards_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.timing_standards_id_seq OWNED BY public.timing_standards.id;


--
-- Name: user_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_invites (
    id integer NOT NULL,
    token text NOT NULL,
    email text NOT NULL,
    role text DEFAULT 'viewer'::text NOT NULL,
    invited_by_id integer,
    invited_at timestamp without time zone DEFAULT now() NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    accepted_at timestamp without time zone
);


--
-- Name: user_invites_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_invites_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_invites_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_invites_id_seq OWNED BY public.user_invites.id;


--
-- Name: andon_issues id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.andon_issues ALTER COLUMN id SET DEFAULT nextval('public.andon_issues_id_seq'::regclass);


--
-- Name: app_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings ALTER COLUMN id SET DEFAULT nextval('public.app_settings_id_seq'::regclass);


--
-- Name: app_users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_users ALTER COLUMN id SET DEFAULT nextval('public.app_users_id_seq'::regclass);


--
-- Name: batch_completions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batch_completions ALTER COLUMN id SET DEFAULT nextval('public.batch_completions_id_seq'::regclass);


--
-- Name: category_defaults id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.category_defaults ALTER COLUMN id SET DEFAULT nextval('public.category_defaults_id_seq'::regclass);


--
-- Name: daily_stock_checks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_stock_checks ALTER COLUMN id SET DEFAULT nextval('public.daily_stock_checks_id_seq'::regclass);


--
-- Name: delivery_check_configs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_check_configs ALTER COLUMN id SET DEFAULT nextval('public.delivery_check_configs_id_seq'::regclass);


--
-- Name: delivery_check_results id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_check_results ALTER COLUMN id SET DEFAULT nextval('public.delivery_check_results_id_seq'::regclass);


--
-- Name: delivery_records id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_records ALTER COLUMN id SET DEFAULT nextval('public.delivery_records_id_seq'::regclass);


--
-- Name: dispatch_orders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispatch_orders ALTER COLUMN id SET DEFAULT nextval('public.dispatch_orders_id_seq'::regclass);


--
-- Name: dpt_ingredient_requirements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dpt_ingredient_requirements ALTER COLUMN id SET DEFAULT nextval('public.dpt_ingredient_requirements_id_seq'::regclass);


--
-- Name: dpt_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dpt_settings ALTER COLUMN id SET DEFAULT nextval('public.dpt_settings_id_seq'::regclass);


--
-- Name: founder_custom_panels id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.founder_custom_panels ALTER COLUMN id SET DEFAULT nextval('public.founder_custom_panels_id_seq'::regclass);


--
-- Name: improvement_submissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.improvement_submissions ALTER COLUMN id SET DEFAULT nextval('public.improvement_submissions_id_seq'::regclass);


--
-- Name: ingredient_storage_locations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingredient_storage_locations ALTER COLUMN id SET DEFAULT nextval('public.ingredient_storage_locations_id_seq'::regclass);


--
-- Name: ingredients id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingredients ALTER COLUMN id SET DEFAULT nextval('public.ingredients_id_seq'::regclass);


--
-- Name: kanban_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kanban_items ALTER COLUMN id SET DEFAULT nextval('public.kanban_items_id_seq'::regclass);


--
-- Name: oven_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oven_events ALTER COLUMN id SET DEFAULT nextval('public.oven_events_id_seq'::regclass);


--
-- Name: password_resets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets ALTER COLUMN id SET DEFAULT nextval('public.password_resets_id_seq'::regclass);


--
-- Name: postcode_validations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.postcode_validations ALTER COLUMN id SET DEFAULT nextval('public.postcode_validations_id_seq'::regclass);


--
-- Name: prep_completions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prep_completions ALTER COLUMN id SET DEFAULT nextval('public.prep_completions_id_seq'::regclass);


--
-- Name: production_plan_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_plan_items ALTER COLUMN id SET DEFAULT nextval('public.production_plan_items_id_seq'::regclass);


--
-- Name: production_plans id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_plans ALTER COLUMN id SET DEFAULT nextval('public.production_plans_id_seq'::regclass);


--
-- Name: purchase_order_lines id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_lines ALTER COLUMN id SET DEFAULT nextval('public.purchase_order_lines_id_seq'::regclass);


--
-- Name: purchase_orders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders ALTER COLUMN id SET DEFAULT nextval('public.purchase_orders_id_seq'::regclass);


--
-- Name: recipe_ingredients id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_ingredients ALTER COLUMN id SET DEFAULT nextval('public.recipe_ingredients_id_seq'::regclass);


--
-- Name: recipe_meat_marinades id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_meat_marinades ALTER COLUMN id SET DEFAULT nextval('public.recipe_meat_marinades_id_seq'::regclass);


--
-- Name: recipe_shopify_mappings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_shopify_mappings ALTER COLUMN id SET DEFAULT nextval('public.recipe_shopify_mappings_id_seq'::regclass);


--
-- Name: recipe_sub_recipes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_sub_recipes ALTER COLUMN id SET DEFAULT nextval('public.recipe_sub_recipes_id_seq'::regclass);


--
-- Name: recipes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipes ALTER COLUMN id SET DEFAULT nextval('public.recipes_id_seq'::regclass);


--
-- Name: sales_entries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_entries ALTER COLUMN id SET DEFAULT nextval('public.sales_entries_id_seq'::regclass);


--
-- Name: station_breaks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.station_breaks ALTER COLUMN id SET DEFAULT nextval('public.station_breaks_id_seq'::regclass);


--
-- Name: stock_entries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_entries ALTER COLUMN id SET DEFAULT nextval('public.stock_entries_id_seq'::regclass);


--
-- Name: stock_item_categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_item_categories ALTER COLUMN id SET DEFAULT nextval('public.stock_item_categories_id_seq'::regclass);


--
-- Name: stock_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_items ALTER COLUMN id SET DEFAULT nextval('public.stock_items_id_seq'::regclass);


--
-- Name: stock_transfers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_transfers ALTER COLUMN id SET DEFAULT nextval('public.stock_transfers_id_seq'::regclass);


--
-- Name: storage_locations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_locations ALTER COLUMN id SET DEFAULT nextval('public.storage_locations_id_seq'::regclass);


--
-- Name: storage_racks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_racks ALTER COLUMN id SET DEFAULT nextval('public.storage_racks_id_seq'::regclass);


--
-- Name: sub_recipe_ingredients id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sub_recipe_ingredients ALTER COLUMN id SET DEFAULT nextval('public.sub_recipe_ingredients_id_seq'::regclass);


--
-- Name: sub_recipe_sub_recipes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sub_recipe_sub_recipes ALTER COLUMN id SET DEFAULT nextval('public.sub_recipe_sub_recipes_id_seq'::regclass);


--
-- Name: sub_recipes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sub_recipes ALTER COLUMN id SET DEFAULT nextval('public.sub_recipes_id_seq'::regclass);


--
-- Name: suppliers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers ALTER COLUMN id SET DEFAULT nextval('public.suppliers_id_seq'::regclass);


--
-- Name: temperature_records id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.temperature_records ALTER COLUMN id SET DEFAULT nextval('public.temperature_records_id_seq'::regclass);


--
-- Name: timing_standards id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timing_standards ALTER COLUMN id SET DEFAULT nextval('public.timing_standards_id_seq'::regclass);


--
-- Name: user_invites id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_invites ALTER COLUMN id SET DEFAULT nextval('public.user_invites_id_seq'::regclass);


--
-- Data for Name: _migrations_done; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public._migrations_done (key, done_at) FROM stdin;
prep_weight_mode_backfill	2026-03-27 17:19:42.682869
\.


--
-- Data for Name: andon_issues; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.andon_issues (id, category, severity, description, station, reported_by, reported_by_name, acknowledged_by, acknowledged_by_name, acknowledged_at, resolved_by, resolved_by_name, resolved_at, created_at) FROM stdin;
1	equipment	red	Broken scales - can't operate	building_1	2	Graeme Carter	2	Graeme Carter	2026-03-26 13:43:59.367	2	Graeme Carter	2026-03-26 15:17:01.393	2026-03-26 13:41:35.992222
\.


--
-- Data for Name: app_settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.app_settings (id, key, value, updated_at) FROM stdin;
1	mixer_capacity_kg	25	2026-03-20 05:43:38.02035
3	total_daily_batches	75	2026-03-22 17:22:00.839
26	apc_test_mode	true	2026-03-23 11:46:08.59
15	apc_weight_threshold_grams	7001	2026-03-23 11:46:18.521
12	apc_service_code_large_weekday	ND16	2026-03-23 11:46:18.527
11	apc_service_code_small_weekday	LW16	2026-03-23 11:46:18.536
14	apc_service_code_small_friday	WL16	2026-03-23 11:46:18.524
13	apc_service_code_large_friday	WD16	2026-03-23 11:46:18.537
72	daily_snack_ball_count	1	2026-03-24 06:34:41.514512
73	daily_extra_pack_ball_count	2	2026-03-24 06:34:41.516235
74	daily_extra_pack_ball_weight_g	230	2026-03-24 06:34:41.516909
75	daily_snack_ball_weight_g	200	2026-03-24 06:34:41.518075
92	production_order_recipe_ids	[1,10,6,5,4,2,3,9,7,8]	2026-03-26 15:41:41.02
1221	admin_plan_date_override	false	2026-03-27 07:20:50.745
1241	may_contain_statement	May also contain traces of nuts, peanuts, egg, soya, celery, sulphites, mustard, wheat and milk	2026-03-27 08:51:17.588994
8	default_break_minutes	15	2026-03-30 13:50:45.419
4149	default_lunch_minutes	45	2026-03-30 13:50:45.419
4233	checklist_done_11_building_2_80	true	2026-03-30 19:28:00.471
4248	checklist_done_11_building_2_81	true	2026-03-30 19:28:03.075805
4249	checklist_done_11_building_1_81	true	2026-03-30 19:28:07.160631
4250	checklist_done_11_building_1_82	true	2026-03-30 19:28:23.37722
4251	checklist_done_11_building_2_82	true	2026-03-30 19:28:30.203283
4453	checklist_done_14_building_2_106	true	2026-03-31 14:07:37.70737
4454	checklist_done_14_building_1_106	true	2026-03-31 14:08:33.839901
4455	checklist_done_14_building_1_107	true	2026-03-31 14:08:35.25387
4456	checklist_done_14_building_1_108	true	2026-03-31 14:08:45.04137
4457	checklist_done_14_building_1_109	true	2026-03-31 14:08:51.517939
\.


--
-- Data for Name: app_users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.app_users (id, name, email, password_hash, role, is_active, created_at, updated_at, pin_hash, pin_attempts, pin_locked_until, avatar_url) FROM stdin;
1	Admin	admin@proplanner.com	$2b$10$V385TR0fsfjsVEqk22a3bOdqGWJYV5Nyb4P34eYzDHOJkS2SL0fHK	admin	t	2026-03-18 15:52:58.978164	2026-03-23 09:24:49.826	\N	0	\N	\N
3	TCK Admin	admin@thecalzonekitchen.co.uk	$2b$10$zWkX3cxQXo76s5YNgwn3j.BOljsZVgp5.TGNXO847Pi.bx1kNwaYe	admin	t	2026-03-23 09:42:39.069159	2026-03-23 09:42:39.069159	$2b$10$hKg.5EOJOwXDkzu5eSuOh.B9PsSQgV7/SdNO8cuizELiWJNPEZSnq	1	\N	\N
2	Graeme Carter	graeme@thecalzonekitchen.co.uk	$2b$10$EGI.24DM97/AlyzSXgWNiucGeGDRW32LeJ33HS8FqvWu/fOB5tk6a	admin	t	2026-03-18 15:55:01.540058	2026-03-25 09:35:07.484	$2b$10$XoJO65Q1hEkwOZ0dMNS.eO1SHvrQTmT2Agzq/PsWleyy27hTDCMv6	0	\N	\N
\.


--
-- Data for Name: batch_completions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.batch_completions (id, plan_item_id, station_type, user_id, started_at, completed_at) FROM stdin;
645	6	mixing	1	\N	2026-03-23 15:43:12.015
646	6	mixing	1	\N	2026-03-23 15:43:12.015
647	6	mixing	1	\N	2026-03-23 15:43:12.015
648	6	mixing	1	\N	2026-03-23 15:43:12.015
649	6	mixing	1	\N	2026-03-23 15:43:12.015
650	6	mixing	1	\N	2026-03-23 15:43:12.015
651	6	mixing	1	\N	2026-03-23 15:43:12.015
652	6	mixing	1	\N	2026-03-23 15:43:12.015
653	6	mixing	1	\N	2026-03-23 15:43:12.015
654	6	mixing	1	\N	2026-03-23 15:43:12.015
655	6	mixing	1	\N	2026-03-23 15:43:13.039
656	6	mixing	1	\N	2026-03-23 15:43:13.039
657	6	mixing	1	\N	2026-03-23 15:43:13.039
658	6	mixing	1	\N	2026-03-23 15:43:13.039
659	6	mixing	1	\N	2026-03-23 15:43:13.039
660	6	mixing	1	\N	2026-03-23 15:43:13.039
661	6	mixing	1	\N	2026-03-23 15:43:13.039
662	6	mixing	1	\N	2026-03-23 15:43:13.039
663	6	mixing	1	\N	2026-03-23 15:43:13.039
664	8	mixing	1	\N	2026-03-23 15:43:14.938
665	8	mixing	1	\N	2026-03-23 15:43:14.938
666	8	mixing	1	\N	2026-03-23 15:43:14.938
188	3	building_1	1	\N	2026-03-20 11:47:47.944
189	3	building_1	1	\N	2026-03-20 11:47:49.346
190	3	building_1	1	\N	2026-03-20 11:47:50.227
191	3	building_1	1	\N	2026-03-20 11:47:51.043
192	3	building_1	1	\N	2026-03-20 11:47:51.993
193	3	building_1	1	\N	2026-03-20 11:47:53.163
194	3	ovens	1	\N	2026-03-20 11:48:00.196
195	3	ovens	1	\N	2026-03-20 11:48:00.996
196	3	ovens	1	\N	2026-03-20 11:48:01.479
197	3	ovens	1	\N	2026-03-20 11:48:01.862
198	3	ovens	1	\N	2026-03-20 11:48:02.33
199	3	ovens	1	\N	2026-03-20 11:48:03.013
667	8	mixing	1	\N	2026-03-23 15:43:14.938
668	8	mixing	1	\N	2026-03-23 15:43:14.938
669	8	mixing	1	\N	2026-03-23 15:43:14.938
670	8	mixing	1	\N	2026-03-23 15:43:14.938
671	8	mixing	1	\N	2026-03-23 15:43:15.711
672	8	mixing	1	\N	2026-03-23 15:43:15.711
673	8	mixing	1	\N	2026-03-23 15:43:15.711
674	8	mixing	1	\N	2026-03-23 15:43:15.711
675	8	mixing	1	\N	2026-03-23 15:43:15.711
676	8	mixing	1	\N	2026-03-23 15:43:15.711
677	8	mixing	1	\N	2026-03-23 15:43:15.711
535	6	building_1	1	\N	2026-03-23 07:34:12.089
536	6	building_1	1	\N	2026-03-23 07:34:13.211
678	5	mixing	1	\N	2026-03-23 15:43:19.196
679	5	mixing	1	\N	2026-03-23 15:43:19.196
680	5	mixing	1	\N	2026-03-23 15:43:19.196
681	5	mixing	1	\N	2026-03-23 15:43:19.196
682	5	mixing	1	\N	2026-03-23 15:43:19.196
593	3	mixing	1	\N	2026-03-23 15:39:41.01
594	3	mixing	1	\N	2026-03-23 15:39:41.01
595	3	mixing	1	\N	2026-03-23 15:39:41.01
596	3	mixing	1	\N	2026-03-23 15:39:41.01
597	3	mixing	1	\N	2026-03-23 15:39:41.01
598	3	mixing	1	\N	2026-03-23 15:39:41.01
225	7	building_1	1	\N	2026-03-20 12:47:24.152
226	7	building_1	1	\N	2026-03-20 12:47:24.907
227	4	building_1	1	\N	2026-03-20 12:47:26.048
228	4	building_1	1	\N	2026-03-20 12:47:26.464
229	4	building_1	1	\N	2026-03-20 12:47:26.867
230	4	building_1	1	\N	2026-03-20 12:47:27.268
231	4	building_1	1	\N	2026-03-20 12:47:27.668
232	4	building_1	1	\N	2026-03-20 12:47:28.051
233	4	building_1	1	\N	2026-03-20 12:47:28.432
234	4	building_1	1	\N	2026-03-20 12:47:28.748
235	4	building_1	1	\N	2026-03-20 12:47:29.182
236	4	building_1	1	\N	2026-03-20 12:47:29.599
237	4	building_1	1	\N	2026-03-20 12:47:29.999
238	4	building_1	1	\N	2026-03-20 12:47:30.398
239	4	building_1	1	\N	2026-03-20 12:47:30.831
240	4	building_1	1	\N	2026-03-20 12:47:31.248
241	4	building_1	1	\N	2026-03-20 12:47:31.749
242	4	building_1	1	\N	2026-03-20 12:47:32.151
243	4	building_1	1	\N	2026-03-20 12:47:32.618
244	4	building_1	1	\N	2026-03-20 12:47:33.036
245	4	building_1	1	\N	2026-03-20 12:47:33.516
246	4	building_1	1	\N	2026-03-20 12:47:34.849
247	4	building_1	1	\N	2026-03-20 12:47:35.668
248	4	building_1	1	\N	2026-03-20 12:47:36.933
249	4	building_1	1	\N	2026-03-20 12:51:02.736
599	7	mixing	1	\N	2026-03-23 15:39:45.898
600	7	mixing	1	\N	2026-03-23 15:39:45.898
266	5	building_1	1	\N	2026-03-20 12:51:24.034
267	5	building_1	1	\N	2026-03-20 12:51:24.88
268	5	building_1	1	\N	2026-03-20 12:51:25.697
269	5	building_1	1	\N	2026-03-20 12:51:26.447
270	5	building_1	1	\N	2026-03-20 12:51:27.165
271	5	building_1	1	\N	2026-03-20 12:51:27.765
272	5	building_1	1	\N	2026-03-20 12:51:28.398
273	5	building_1	1	\N	2026-03-20 12:51:28.947
274	5	building_1	1	\N	2026-03-20 12:51:29.565
275	5	building_1	1	\N	2026-03-20 12:51:30.264
276	5	building_1	1	\N	2026-03-20 12:51:30.848
277	5	building_1	1	\N	2026-03-20 12:51:31.532
278	5	building_1	1	\N	2026-03-20 12:51:32.114
279	5	building_1	1	\N	2026-03-20 12:51:32.698
280	5	building_1	1	\N	2026-03-20 12:51:33.446
281	5	building_1	1	\N	2026-03-20 12:51:34.032
282	7	ovens	1	\N	2026-03-20 12:55:57.704
283	7	ovens	1	\N	2026-03-20 12:56:00.388
284	4	ovens	1	\N	2026-03-20 12:56:04.455
285	4	ovens	1	\N	2026-03-20 12:56:06.254
286	4	ovens	1	\N	2026-03-20 12:56:08.615
287	4	ovens	1	\N	2026-03-20 12:56:10.267
288	4	ovens	1	\N	2026-03-20 12:56:11.233
289	4	ovens	1	\N	2026-03-20 12:56:12.183
290	4	ovens	1	\N	2026-03-20 12:56:13.6
291	4	ovens	1	\N	2026-03-20 12:56:14.365
292	4	ovens	1	\N	2026-03-20 12:56:14.866
293	4	ovens	1	\N	2026-03-20 12:56:15.532
294	4	ovens	1	\N	2026-03-20 12:56:23.217
306	3	dough_prep	1	\N	2026-03-21 08:02:24.781
307	3	dough_prep	1	\N	2026-03-21 08:02:26.299
308	3	dough_prep	1	\N	2026-03-21 08:02:27.174
309	3	dough_prep	1	\N	2026-03-21 08:02:27.762
310	4	dough_prep	1	\N	2026-03-21 08:02:29.112
311	3	dough_prep	1	\N	2026-03-21 08:02:29.112
312	4	dough_prep	1	\N	2026-03-21 08:02:29.112
313	3	dough_prep	1	\N	2026-03-21 08:02:29.112
314	4	dough_prep	1	\N	2026-03-21 08:02:30.147
315	4	dough_prep	1	\N	2026-03-21 08:02:30.147
316	4	dough_prep	1	\N	2026-03-21 08:02:30.147
317	4	dough_prep	1	\N	2026-03-21 08:02:30.147
318	4	dough_prep	1	\N	2026-03-21 08:02:30.974
319	4	dough_prep	1	\N	2026-03-21 08:02:30.974
320	4	dough_prep	1	\N	2026-03-21 08:02:30.974
321	4	dough_prep	1	\N	2026-03-21 08:02:30.974
325	4	dough_prep	1	\N	2026-03-21 08:02:31.836
537	6	building_1	1	\N	2026-03-23 07:34:14.181
538	6	building_1	1	\N	2026-03-23 07:34:15.389
367	4	dough_sheeting	1	\N	2026-03-21 13:55:29.174
368	4	dough_sheeting	1	\N	2026-03-21 13:55:30.608
369	4	dough_sheeting	1	\N	2026-03-21 13:55:31.751
370	4	dough_sheeting	1	\N	2026-03-21 13:55:32.743
371	4	dough_sheeting	1	\N	2026-03-21 13:55:33.836
683	5	mixing	1	\N	2026-03-23 15:43:19.196
684	5	mixing	1	\N	2026-03-23 15:43:19.907
685	5	mixing	1	\N	2026-03-23 15:43:19.907
686	5	mixing	1	\N	2026-03-23 15:43:19.907
687	5	mixing	1	\N	2026-03-23 15:43:19.907
688	5	mixing	1	\N	2026-03-23 15:43:19.907
689	5	mixing	1	\N	2026-03-23 15:43:19.907
690	5	mixing	1	\N	2026-03-23 15:43:20.757
691	5	mixing	1	\N	2026-03-23 15:43:20.757
692	5	mixing	1	\N	2026-03-23 15:43:20.757
693	5	mixing	1	\N	2026-03-23 15:43:20.757
539	6	building_1	1	\N	2026-03-23 07:34:16.344
540	6	building_1	1	\N	2026-03-23 07:34:16.944
541	6	building_1	1	\N	2026-03-23 07:34:17.432
542	6	building_1	1	\N	2026-03-23 07:34:17.94
543	6	building_1	1	\N	2026-03-23 07:34:18.39
544	6	building_1	1	\N	2026-03-23 07:34:18.978
545	6	building_1	1	\N	2026-03-23 07:34:19.16
546	6	building_1	1	\N	2026-03-23 07:34:20.861
547	6	building_1	1	\N	2026-03-23 07:34:21.276
495	7	dough_prep	1	\N	2026-03-23 07:24:54.389
496	7	dough_prep	1	\N	2026-03-23 07:24:55.503
548	6	building_1	1	\N	2026-03-23 07:34:21.598
549	6	building_1	1	\N	2026-03-23 07:34:21.86
550	6	building_1	1	\N	2026-03-23 07:34:22.223
551	6	building_1	1	\N	2026-03-23 07:34:22.427
552	6	building_1	1	\N	2026-03-23 07:34:22.843
553	6	building_1	1	\N	2026-03-23 07:34:23.162
703	3	building_2	1	\N	2026-03-23 15:52:13.739
704	3	building_2	1	\N	2026-03-23 15:52:18.243
705	3	building_2	1	\N	2026-03-23 15:52:18.819
706	3	building_2	1	\N	2026-03-23 15:52:20.022
711	6	ovens	1	\N	2026-03-23 15:56:23.173
712	6	ovens	1	\N	2026-03-23 15:56:23.89
713	6	ovens	1	\N	2026-03-23 15:56:25.361
714	6	ovens	1	\N	2026-03-23 15:56:26.107
715	6	ovens	1	\N	2026-03-23 15:56:26.757
716	6	ovens	1	\N	2026-03-23 15:56:44.507
717	6	ovens	1	\N	2026-03-23 15:56:45.407
718	6	ovens	1	\N	2026-03-23 15:57:16.173
719	6	ovens	1	\N	2026-03-23 15:57:24.39
720	6	ovens	1	\N	2026-03-23 15:57:25.608
721	6	ovens	1	\N	2026-03-23 15:57:27.708
722	6	ovens	1	\N	2026-03-23 15:57:28.557
723	6	ovens	1	\N	2026-03-23 15:57:29.29
724	6	ovens	1	\N	2026-03-23 15:57:29.89
725	8	ovens	1	\N	2026-03-23 15:57:30.463
735	25	dough_prep	1	\N	2026-03-23 16:15:13.165
749	27	dough_prep	1	\N	2026-03-23 16:17:03.564
770	25	mixing	1	\N	2026-03-23 16:17:50.03
771	25	mixing	1	\N	2026-03-23 16:17:50.03
772	25	mixing	1	\N	2026-03-23 16:17:50.03
773	25	mixing	1	\N	2026-03-23 16:17:50.03
774	25	mixing	1	\N	2026-03-23 16:17:50.03
775	25	mixing	1	\N	2026-03-23 16:17:50.03
776	25	mixing	1	\N	2026-03-23 16:17:50.03
777	25	mixing	1	\N	2026-03-23 16:17:50.03
778	25	mixing	1	\N	2026-03-23 16:17:50.03
779	26	mixing	1	\N	2026-03-23 16:17:50.813
780	26	mixing	1	\N	2026-03-23 16:17:50.813
781	26	mixing	1	\N	2026-03-23 16:17:50.813
782	27	mixing	1	\N	2026-03-23 16:18:53.008
783	27	mixing	1	\N	2026-03-23 16:18:53.008
784	27	mixing	1	\N	2026-03-23 16:18:53.008
785	27	mixing	1	\N	2026-03-23 16:18:53.008
786	27	mixing	1	\N	2026-03-23 16:18:53.008
787	27	mixing	1	\N	2026-03-23 16:18:53.008
788	27	mixing	1	\N	2026-03-23 16:18:53.008
789	27	mixing	1	\N	2026-03-23 16:18:53.008
790	27	mixing	1	\N	2026-03-23 16:18:53.008
791	28	mixing	1	\N	2026-03-23 16:19:02.673
792	28	mixing	1	\N	2026-03-23 16:19:02.673
793	28	mixing	1	\N	2026-03-23 16:19:02.673
794	28	mixing	1	\N	2026-03-23 16:19:02.673
795	28	mixing	1	\N	2026-03-23 16:19:02.673
796	28	mixing	1	\N	2026-03-23 16:19:02.673
797	28	mixing	1	\N	2026-03-23 16:19:02.673
798	28	mixing	1	\N	2026-03-23 16:19:02.673
799	28	mixing	1	\N	2026-03-23 16:19:02.673
800	28	mixing	1	\N	2026-03-23 16:19:03.647
801	28	mixing	1	\N	2026-03-23 16:19:03.647
802	28	mixing	1	\N	2026-03-23 16:19:03.647
803	28	mixing	1	\N	2026-03-23 16:19:03.647
804	28	mixing	1	\N	2026-03-23 16:19:03.647
805	28	mixing	1	\N	2026-03-23 16:19:03.647
806	28	mixing	1	\N	2026-03-23 16:19:03.647
807	28	mixing	1	\N	2026-03-23 16:19:03.647
808	28	mixing	1	\N	2026-03-23 16:19:03.647
809	28	mixing	1	\N	2026-03-23 16:19:04.394
810	28	mixing	1	\N	2026-03-23 16:19:04.394
811	28	mixing	1	\N	2026-03-23 16:19:04.394
812	28	mixing	1	\N	2026-03-23 16:19:04.394
813	28	mixing	1	\N	2026-03-23 16:19:04.394
814	28	mixing	1	\N	2026-03-23 16:19:04.394
815	28	mixing	1	\N	2026-03-23 16:19:04.394
816	24	building_1	1	\N	2026-03-23 16:19:15.665
818	24	building_1	1	\N	2026-03-23 16:22:52.632
819	24	building_1	1	\N	2026-03-23 16:22:53.6
824	8	ovens	1	\N	2026-03-24 06:20:45.422
825	8	ovens	1	\N	2026-03-24 06:20:46.088
826	8	ovens	1	\N	2026-03-24 06:20:46.859
847	27	building_1	2	\N	2026-03-25 11:51:57.548
848	27	building_1	2	\N	2026-03-25 11:51:57.853
849	27	building_1	2	\N	2026-03-25 11:51:57.998
850	27	building_1	2	\N	2026-03-25 11:51:58.181
851	27	building_1	2	\N	2026-03-25 11:51:58.331
852	28	building_1	2	\N	2026-03-25 11:52:01.099
853	28	building_1	2	\N	2026-03-25 11:52:01.544
854	28	building_1	2	\N	2026-03-25 11:52:01.816
855	28	building_1	2	\N	2026-03-25 11:52:02.177
856	28	building_1	2	\N	2026-03-25 11:52:02.377
857	28	building_1	2	\N	2026-03-25 11:52:02.541
858	28	building_1	2	\N	2026-03-25 11:52:02.694
859	28	building_1	2	\N	2026-03-25 11:52:02.98
860	28	building_1	2	\N	2026-03-25 11:52:03.348
861	25	ovens	2	\N	2026-03-25 11:52:07.046
862	25	ovens	2	\N	2026-03-25 11:52:07.779
863	25	ovens	2	\N	2026-03-25 11:52:08.024
864	25	ovens	2	\N	2026-03-25 11:52:08.458
865	25	ovens	2	\N	2026-03-25 11:52:12.182
866	25	ovens	2	\N	2026-03-25 11:52:12.565
867	25	ovens	2	\N	2026-03-25 11:52:12.991
868	25	ovens	2	\N	2026-03-25 11:52:13.261
869	25	ovens	2	\N	2026-03-25 11:52:13.444
870	26	ovens	2	\N	2026-03-25 11:52:13.824
871	26	ovens	2	\N	2026-03-25 11:52:14.024
872	26	ovens	2	\N	2026-03-25 11:52:14.195
873	27	ovens	2	\N	2026-03-25 11:52:14.557
554	5	ovens	1	\N	2026-03-23 07:34:30.715
330	3	dough_sheeting	1	\N	2026-03-21 09:02:47.101
331	3	dough_sheeting	1	\N	2026-03-21 09:02:48.243
332	3	dough_sheeting	1	\N	2026-03-21 09:02:49.112
333	3	dough_sheeting	1	\N	2026-03-21 09:02:50.338
334	3	dough_sheeting	1	\N	2026-03-21 09:02:51.57
335	3	dough_sheeting	1	\N	2026-03-21 09:02:52.445
336	7	dough_sheeting	1	\N	2026-03-21 09:02:53.522
337	7	dough_sheeting	1	\N	2026-03-21 09:02:54.301
338	4	dough_sheeting	1	\N	2026-03-21 09:02:54.861
339	4	dough_sheeting	1	\N	2026-03-21 09:02:55.699
340	4	dough_sheeting	1	\N	2026-03-21 09:02:56.269
341	4	dough_sheeting	1	\N	2026-03-21 09:02:56.967
342	4	dough_sheeting	1	\N	2026-03-21 09:02:57.68
343	4	dough_sheeting	1	\N	2026-03-21 09:02:58.321
344	4	dough_sheeting	1	\N	2026-03-21 09:02:59.05
345	4	dough_sheeting	1	\N	2026-03-21 09:02:59.686
346	4	dough_sheeting	1	\N	2026-03-21 09:03:00.359
347	4	dough_sheeting	1	\N	2026-03-21 09:03:01.029
348	4	dough_sheeting	1	\N	2026-03-21 09:03:01.767
349	4	dough_sheeting	1	\N	2026-03-21 09:03:02.467
350	4	dough_sheeting	1	\N	2026-03-21 09:03:03.273
351	4	dough_sheeting	1	\N	2026-03-21 09:03:04.209
352	4	dough_sheeting	1	\N	2026-03-21 09:03:04.794
555	5	ovens	1	\N	2026-03-23 07:34:31.872
556	5	ovens	1	\N	2026-03-23 07:34:32.731
557	5	ovens	1	\N	2026-03-23 07:34:33.414
558	5	ovens	1	\N	2026-03-23 07:34:34.307
559	5	ovens	1	\N	2026-03-23 07:34:34.961
560	5	ovens	1	\N	2026-03-23 07:34:35.243
561	5	ovens	1	\N	2026-03-23 07:34:35.444
562	5	ovens	1	\N	2026-03-23 07:34:35.606
563	5	ovens	1	\N	2026-03-23 07:34:35.76
564	5	ovens	1	\N	2026-03-23 07:34:35.893
565	5	ovens	1	\N	2026-03-23 07:34:36.027
566	5	ovens	1	\N	2026-03-23 07:34:36.176
567	5	ovens	1	\N	2026-03-23 07:34:36.527
568	5	ovens	1	\N	2026-03-23 07:34:36.891
569	5	ovens	1	\N	2026-03-23 07:34:37.027
570	6	ovens	1	\N	2026-03-23 07:34:37.525
694	8	building_1	1	\N	2026-03-23 15:51:53.649
695	8	building_1	1	\N	2026-03-23 15:51:54.623
696	8	building_1	1	\N	2026-03-23 15:51:56.186
697	8	building_1	1	\N	2026-03-23 15:51:56.944
698	8	building_1	1	\N	2026-03-23 15:51:57.656
699	8	building_1	1	\N	2026-03-23 15:52:03.806
702	3	building_2	1	\N	2026-03-23 15:52:12.656
707	6	ovens	1	\N	2026-03-23 15:56:07.996
708	6	ovens	1	\N	2026-03-23 15:56:11.678
709	6	ovens	1	\N	2026-03-23 15:56:12.645
710	6	ovens	1	\N	2026-03-23 15:56:13.306
726	24	dough_prep	1	\N	2026-03-23 16:14:58.082
727	24	dough_prep	1	\N	2026-03-23 16:14:58.848
728	24	dough_prep	1	\N	2026-03-23 16:14:59.53
729	25	dough_prep	1	\N	2026-03-23 16:15:01.035
730	25	dough_prep	1	\N	2026-03-23 16:15:11.914
731	25	dough_prep	1	\N	2026-03-23 16:15:11.914
732	25	dough_prep	1	\N	2026-03-23 16:15:11.914
733	25	dough_prep	1	\N	2026-03-23 16:15:11.914
734	25	dough_prep	1	\N	2026-03-23 16:15:13.165
736	25	dough_prep	1	\N	2026-03-23 16:15:13.165
737	25	dough_prep	1	\N	2026-03-23 16:15:13.165
738	26	dough_prep	1	\N	2026-03-23 16:15:20.182
739	26	dough_prep	1	\N	2026-03-23 16:15:20.182
740	27	dough_prep	1	\N	2026-03-23 16:15:20.182
741	26	dough_prep	1	\N	2026-03-23 16:15:20.182
742	27	dough_prep	1	\N	2026-03-23 16:15:21.047
743	27	dough_prep	1	\N	2026-03-23 16:15:21.047
744	27	dough_prep	1	\N	2026-03-23 16:15:21.047
745	27	dough_prep	1	\N	2026-03-23 16:15:21.047
746	27	dough_prep	1	\N	2026-03-23 16:17:03.564
750	24	dough_sheeting	1	\N	2026-03-23 16:17:19.604
751	24	dough_sheeting	1	\N	2026-03-23 16:17:20.58
752	24	dough_sheeting	1	\N	2026-03-23 16:17:22.46
753	25	dough_sheeting	1	\N	2026-03-23 16:17:24.651
754	25	dough_sheeting	1	\N	2026-03-23 16:17:25.606
755	25	dough_sheeting	1	\N	2026-03-23 16:17:26.343
756	25	dough_sheeting	1	\N	2026-03-23 16:17:27.179
757	25	dough_sheeting	1	\N	2026-03-23 16:17:27.907
758	25	dough_sheeting	1	\N	2026-03-23 16:17:28.642
759	25	dough_sheeting	1	\N	2026-03-23 16:17:29.557
760	25	dough_sheeting	1	\N	2026-03-23 16:17:30.476
761	25	dough_sheeting	1	\N	2026-03-23 16:17:31.411
762	26	dough_sheeting	1	\N	2026-03-23 16:17:33.472
763	26	dough_sheeting	1	\N	2026-03-23 16:17:34.306
764	26	dough_sheeting	1	\N	2026-03-23 16:17:35.077
765	27	dough_sheeting	1	\N	2026-03-23 16:17:36.643
766	27	dough_sheeting	1	\N	2026-03-23 16:17:37.341
767	24	mixing	1	\N	2026-03-23 16:17:48.678
768	24	mixing	1	\N	2026-03-23 16:17:48.678
769	24	mixing	1	\N	2026-03-23 16:17:48.678
820	24	ovens	1	\N	2026-03-23 16:22:56.975
821	24	ovens	1	\N	2026-03-23 16:22:57.733
822	24	ovens	1	\N	2026-03-23 16:22:58.3
829	5	dough_prep	1	\N	2026-03-24 06:39:11.842
830	25	building_1	2	\N	2026-03-25 11:51:47.282
831	25	building_1	2	\N	2026-03-25 11:51:47.849
832	25	building_1	2	\N	2026-03-25 11:51:48.358
833	25	building_1	2	\N	2026-03-25 11:51:48.561
834	25	building_1	2	\N	2026-03-25 11:51:48.761
835	25	building_1	2	\N	2026-03-25 11:51:48.961
836	25	building_1	2	\N	2026-03-25 11:51:49.157
837	25	building_1	2	\N	2026-03-25 11:51:49.341
497	5	dough_sheeting	1	\N	2026-03-23 07:25:25.084
498	5	dough_sheeting	1	\N	2026-03-23 07:25:26.349
499	5	dough_sheeting	1	\N	2026-03-23 07:25:28.098
500	5	dough_sheeting	1	\N	2026-03-23 07:25:29.316
501	5	dough_sheeting	1	\N	2026-03-23 07:25:30.527
838	25	building_1	2	\N	2026-03-25 11:51:49.698
839	26	building_1	2	\N	2026-03-25 11:51:54.932
840	26	building_1	2	\N	2026-03-25 11:51:55.257
841	26	building_1	2	\N	2026-03-25 11:51:55.457
842	27	building_1	2	\N	2026-03-25 11:51:55.807
844	27	building_1	2	\N	2026-03-25 11:51:56.915
845	27	building_1	2	\N	2026-03-25 11:51:57.231
846	27	building_1	2	\N	2026-03-25 11:51:57.398
874	27	ovens	2	\N	2026-03-25 11:52:14.728
875	27	ovens	2	\N	2026-03-25 11:52:16.427
876	27	ovens	2	\N	2026-03-25 11:52:16.61
877	27	ovens	2	\N	2026-03-25 11:52:22.249
878	27	ovens	2	\N	2026-03-25 11:52:22.741
879	27	ovens	2	\N	2026-03-25 11:52:24.46
880	27	ovens	2	\N	2026-03-25 13:14:01.673
881	27	ovens	2	\N	2026-03-25 13:14:01.88
882	28	ovens	2	\N	2026-03-25 13:14:02.263
883	28	ovens	2	\N	2026-03-25 13:14:02.43
884	28	ovens	2	\N	2026-03-25 13:14:02.614
885	28	ovens	2	\N	2026-03-25 13:14:02.781
886	28	ovens	2	\N	2026-03-25 13:14:02.93
887	28	ovens	2	\N	2026-03-25 13:14:03.063
888	28	ovens	2	\N	2026-03-25 13:14:03.28
889	28	ovens	2	\N	2026-03-25 13:14:03.413
890	28	ovens	2	\N	2026-03-25 13:14:03.513
919	76	mixing	2	\N	2026-03-30 17:36:43.89
920	76	mixing	2	\N	2026-03-30 17:36:43.89
921	76	mixing	2	\N	2026-03-30 17:36:43.89
922	76	mixing	2	\N	2026-03-30 17:36:43.89
923	76	mixing	2	\N	2026-03-30 17:36:43.89
924	76	mixing	2	\N	2026-03-30 17:36:43.89
925	76	mixing	2	\N	2026-03-30 17:36:43.89
926	76	mixing	2	\N	2026-03-30 17:36:43.89
927	77	mixing	2	\N	2026-03-30 17:36:44.963
928	77	mixing	2	\N	2026-03-30 17:36:44.963
929	77	mixing	2	\N	2026-03-30 17:36:44.963
930	77	mixing	2	\N	2026-03-30 17:36:44.963
931	77	mixing	2	\N	2026-03-30 17:36:44.963
932	77	mixing	2	\N	2026-03-30 17:36:44.963
933	78	mixing	2	\N	2026-03-30 17:36:45.842
934	78	mixing	2	\N	2026-03-30 17:36:45.842
935	78	mixing	2	\N	2026-03-30 17:36:45.842
936	79	mixing	2	\N	2026-03-30 17:36:47.106
937	79	mixing	2	\N	2026-03-30 17:36:47.106
938	80	mixing	2	\N	2026-03-30 17:36:47.857
939	80	mixing	2	\N	2026-03-30 17:36:47.857
940	80	mixing	2	\N	2026-03-30 17:36:47.857
941	80	mixing	2	\N	2026-03-30 17:36:47.857
942	80	mixing	2	\N	2026-03-30 17:36:47.857
943	80	mixing	2	\N	2026-03-30 17:36:47.857
944	80	mixing	2	\N	2026-03-30 17:36:47.857
945	76	building_1	2	\N	2026-03-30 17:38:55.15
946	76	building_1	2	\N	2026-03-30 17:38:55.75
947	76	building_1	2	\N	2026-03-30 17:38:56.233
948	76	building_1	2	\N	2026-03-30 17:38:56.607
949	76	building_1	2	\N	2026-03-30 17:38:56.841
950	76	building_1	2	\N	2026-03-30 17:38:57.049
951	76	building_1	2	\N	2026-03-30 17:38:57.266
952	76	building_1	2	\N	2026-03-30 17:38:57.482
953	77	building_1	2	\N	2026-03-30 17:38:57.857
954	77	building_1	2	\N	2026-03-30 17:39:00.641
955	77	building_1	2	\N	2026-03-30 17:39:01.058
956	77	building_1	2	\N	2026-03-30 17:39:01.41
957	77	building_1	2	\N	2026-03-30 17:39:01.766
958	77	building_1	2	\N	2026-03-30 17:39:02.216
959	78	building_1	2	\N	2026-03-30 17:39:06.482
960	78	building_1	2	\N	2026-03-30 17:39:07.083
961	78	building_1	2	\N	2026-03-30 17:39:07.583
962	96	mixing	2	\N	2026-03-30 17:54:23.44
963	96	mixing	2	\N	2026-03-30 17:54:23.44
964	96	mixing	2	\N	2026-03-30 17:54:23.44
965	96	mixing	2	\N	2026-03-30 17:54:23.44
966	96	mixing	2	\N	2026-03-30 17:54:23.44
967	96	mixing	2	\N	2026-03-30 17:54:23.44
968	96	mixing	2	\N	2026-03-30 17:54:23.44
969	96	mixing	2	\N	2026-03-30 17:54:23.44
970	97	mixing	2	\N	2026-03-30 17:54:25.09
971	97	mixing	2	\N	2026-03-30 17:54:25.09
972	97	mixing	2	\N	2026-03-30 17:54:25.09
973	97	mixing	2	\N	2026-03-30 17:54:25.09
974	97	mixing	2	\N	2026-03-30 17:54:25.09
975	97	mixing	2	\N	2026-03-30 17:54:25.09
976	96	building_1	2	\N	2026-03-30 17:54:56.32
977	96	building_1	2	\N	2026-03-30 17:54:59.729
978	96	building_1	2	\N	2026-03-30 17:55:00.303
979	96	building_1	2	\N	2026-03-30 17:55:00.453
980	96	building_1	2	\N	2026-03-30 17:55:00.619
981	96	building_1	2	\N	2026-03-30 17:55:00.763
982	96	building_1	2	\N	2026-03-30 17:55:01.078
983	96	building_1	2	\N	2026-03-30 17:55:01.228
984	97	building_1	2	\N	2026-03-30 17:55:01.812
985	97	building_1	2	\N	2026-03-30 17:55:03.236
986	97	building_1	2	\N	2026-03-30 17:55:03.411
987	97	building_1	2	\N	2026-03-30 17:55:03.578
988	97	building_1	2	\N	2026-03-30 17:55:03.73
989	97	building_1	2	\N	2026-03-30 17:55:03.894
990	96	ovens	2	\N	2026-03-30 17:55:13.625
991	96	ovens	2	\N	2026-03-30 17:55:14.308
992	96	ovens	2	\N	2026-03-30 17:55:16.32
993	96	ovens	2	\N	2026-03-30 17:55:17.17
994	96	ovens	2	\N	2026-03-30 17:55:17.954
995	96	ovens	2	\N	2026-03-30 17:55:18.654
996	96	ovens	2	\N	2026-03-30 17:55:21.521
997	96	ovens	2	\N	2026-03-30 17:55:22.199
998	97	ovens	2	\N	2026-03-30 17:55:24.124
999	97	ovens	2	\N	2026-03-30 17:55:25.803
1000	97	ovens	2	\N	2026-03-30 17:55:26.554
1001	97	ovens	2	\N	2026-03-30 17:55:27.001
1002	97	ovens	2	\N	2026-03-30 17:55:27.688
1003	97	ovens	2	\N	2026-03-30 17:55:28.17
1004	81	mixing	2	\N	2026-03-30 17:59:30.075
1005	81	mixing	2	\N	2026-03-30 17:59:30.075
1006	81	mixing	2	\N	2026-03-30 17:59:30.075
1007	81	mixing	2	\N	2026-03-30 17:59:30.075
1008	81	mixing	2	\N	2026-03-30 17:59:30.075
1009	81	mixing	2	\N	2026-03-30 17:59:30.075
1010	81	mixing	2	\N	2026-03-30 17:59:30.075
1011	81	mixing	2	\N	2026-03-30 17:59:30.075
1023	83	mixing	2	\N	2026-03-30 17:59:31.539
1024	83	mixing	2	\N	2026-03-30 17:59:31.539
1025	83	mixing	2	\N	2026-03-30 17:59:31.539
1026	83	mixing	2	\N	2026-03-30 17:59:31.539
1027	83	mixing	2	\N	2026-03-30 17:59:31.539
1028	83	mixing	2	\N	2026-03-30 17:59:31.539
1029	84	mixing	2	\N	2026-03-30 17:59:32.242
1030	84	mixing	2	\N	2026-03-30 17:59:32.242
1031	84	mixing	2	\N	2026-03-30 17:59:32.242
1032	84	mixing	2	\N	2026-03-30 17:59:32.242
1033	84	mixing	2	\N	2026-03-30 17:59:32.242
1034	84	mixing	2	\N	2026-03-30 17:59:32.242
1035	84	mixing	2	\N	2026-03-30 17:59:32.242
1036	79	building_1	2	\N	2026-03-30 17:59:37.821
1037	79	building_1	2	\N	2026-03-30 17:59:38.596
1038	80	building_2	2	\N	2026-03-30 17:59:53.887
1039	80	building_2	2	\N	2026-03-30 17:59:54.7
1040	80	building_2	2	\N	2026-03-30 17:59:55.233
1041	80	building_2	2	\N	2026-03-30 17:59:55.692
1042	80	building_2	2	\N	2026-03-30 17:59:56.317
1043	76	ovens	2	\N	2026-03-30 18:02:28.104
1044	76	ovens	2	\N	2026-03-30 18:02:28.828
1045	76	ovens	2	\N	2026-03-30 18:02:29.328
1046	76	ovens	2	\N	2026-03-30 18:02:29.809
1047	76	ovens	2	\N	2026-03-30 18:02:31.942
1048	76	ovens	2	\N	2026-03-30 18:02:32.642
1049	76	ovens	2	\N	2026-03-30 18:02:33.278
1050	76	ovens	2	\N	2026-03-30 18:02:33.957
1051	77	ovens	2	\N	2026-03-30 18:02:34.625
1052	77	ovens	2	\N	2026-03-30 18:02:38.17
1053	77	ovens	2	\N	2026-03-30 18:02:38.834
1054	77	ovens	2	\N	2026-03-30 18:02:39.463
1055	77	ovens	2	\N	2026-03-30 18:02:40.085
1056	77	ovens	2	\N	2026-03-30 18:02:40.729
1057	78	ovens	2	\N	2026-03-30 18:02:41.313
1058	78	ovens	2	\N	2026-03-30 18:02:41.89
1059	78	ovens	2	\N	2026-03-30 18:02:42.439
1060	79	ovens	2	\N	2026-03-30 18:02:43.007
1061	82	mixing	2	\N	2026-03-30 19:20:55.785
1062	82	mixing	2	\N	2026-03-30 19:20:55.785
1063	82	mixing	2	\N	2026-03-30 19:20:55.785
1064	82	mixing	2	\N	2026-03-30 19:20:55.785
1065	82	mixing	2	\N	2026-03-30 19:20:55.785
1066	82	mixing	2	\N	2026-03-30 19:20:55.785
1067	82	mixing	2	\N	2026-03-30 19:20:55.785
1068	82	mixing	2	\N	2026-03-30 19:20:55.785
1069	82	mixing	2	\N	2026-03-30 19:20:55.785
1070	82	mixing	2	\N	2026-03-30 19:20:55.785
1071	82	mixing	2	\N	2026-03-30 19:20:55.785
1072	80	building_2	2	\N	2026-03-30 19:28:01.319
1073	80	building_2	2	\N	2026-03-30 19:28:02.443
1074	81	building_1	2	\N	2026-03-30 19:28:08.251
1075	81	building_1	2	\N	2026-03-30 19:28:09.826
1076	81	building_2	2	\N	2026-03-30 19:28:16.38
1077	81	building_2	2	\N	2026-03-30 19:28:17.068
1078	81	building_2	2	\N	2026-03-30 19:28:17.376
1079	81	building_2	2	\N	2026-03-30 19:28:17.551
1080	81	building_2	2	\N	2026-03-30 19:28:17.71
1081	81	building_2	2	\N	2026-03-30 19:28:18.001
1082	82	building_1	2	\N	2026-03-30 19:28:26.451
1083	82	building_2	2	\N	2026-03-30 19:28:30.514
1084	82	building_2	2	\N	2026-03-30 19:28:31.523
1085	106	mixing	2	\N	2026-03-31 14:07:51.939
1086	106	mixing	2	\N	2026-03-31 14:07:51.939
1087	106	mixing	2	\N	2026-03-31 14:07:51.939
1088	106	mixing	2	\N	2026-03-31 14:07:51.939
1089	107	mixing	2	\N	2026-03-31 14:07:53.61
1090	107	mixing	2	\N	2026-03-31 14:07:53.61
1091	108	mixing	2	\N	2026-03-31 14:07:54.558
1092	108	mixing	2	\N	2026-03-31 14:07:54.558
1093	108	mixing	2	\N	2026-03-31 14:07:54.558
1094	108	mixing	2	\N	2026-03-31 14:07:54.558
1095	108	mixing	2	\N	2026-03-31 14:07:55.298
1096	108	mixing	2	\N	2026-03-31 14:07:55.298
1097	108	mixing	2	\N	2026-03-31 14:07:55.298
1098	108	mixing	2	\N	2026-03-31 14:07:55.298
1099	106	building_1	2	\N	2026-03-31 14:08:34.675
1100	107	building_1	2	\N	2026-03-31 14:08:40.788
1101	108	building_1	2	\N	2026-03-31 14:08:47.267
\.


--
-- Data for Name: category_defaults; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.category_defaults (id, category, default_packaging_cost, default_labour_cost, created_at, default_pack_size) FROM stdin;
1	Calzones	0.4000	3.0000	2026-03-19 14:43:37.682078	2
\.


--
-- Data for Name: daily_stock_checks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.daily_stock_checks (id, ingredient_id, check_date, quantity, user_id, checked_at) FROM stdin;
5	58	2026-03-25	10.0000	1	2026-03-20 15:51:24.360826
4	12	2026-03-25	2.0000	1	2026-03-20 18:59:03.317122
8	18	2026-03-25	200.0000	1	2026-03-23 07:27:47.752883
\.


--
-- Data for Name: delivery_check_configs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.delivery_check_configs (id, supplier_id, label, is_required, sort_order) FROM stdin;
\.


--
-- Data for Name: delivery_check_results; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.delivery_check_results (id, delivery_record_id, check_config_id, passed, notes) FROM stdin;
\.


--
-- Data for Name: delivery_records; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.delivery_records (id, purchase_order_id, supplier_id, received_at, received_by_user_id, chilled_temp_c, frozen_temp_c, invoice_filed, all_put_away, kanbans_replaced, notes) FROM stdin;
\.


--
-- Data for Name: dispatch_orders; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.dispatch_orders (id, recipe_id, dispatch_date, quantity, customer, status, notes, created_at, fulfilled_at) FROM stdin;
\.


--
-- Data for Name: dpt_ingredient_requirements; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.dpt_ingredient_requirements (id, ingredient_id, daily_qty_raw, daily_qty_cooked, unit, calculated_at) FROM stdin;
\.


--
-- Data for Name: dpt_settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.dpt_settings (id, recipe_id, default_batches_per_day, is_active, updated_at, surplus_percent, packs_sold) FROM stdin;
6	6	0.00	t	2026-03-22 17:22:00.984	20.00	387
1	3	0.00	t	2026-03-22 17:22:01.115	20.00	1273
2	5	0.00	t	2026-03-22 17:22:01.34	20.00	800
3	2	0.00	t	2026-03-22 17:22:01.481	20.00	1077
8	9	0.00	t	2026-03-22 17:22:01.622	20.00	615
9	10	0.00	t	2026-03-22 17:22:01.761	20.00	500
4	1	0.00	t	2026-03-22 17:22:01.905	20.00	998
7	7	0.00	t	2026-03-22 17:22:02.052	20.00	699
10	8	0.00	t	2026-03-22 17:22:02.199	20.00	700
5	4	0.00	t	2026-03-22 17:22:02.391	20.00	891
\.


--
-- Data for Name: founder_custom_panels; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.founder_custom_panels (id, tag, label, created_at) FROM stdin;
\.


--
-- Data for Name: improvement_submissions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.improvement_submissions (id, title, description, station, submitted_by, submitted_by_name, approval_tier, progress_status, notes, created_at, updated_at, type) FROM stdin;
1	G Test imporvemrnt	decsription here.	building_1	2	Graeme Carter	minor	approved	\N	2026-03-26 13:29:41.626417	2026-03-31 16:03:04.015	improvement
\.


--
-- Data for Name: ingredient_storage_locations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ingredient_storage_locations (id, ingredient_id, location_id, rack_label, shelf_label) FROM stdin;
\.


--
-- Data for Name: ingredients; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ingredients (id, name, unit, cost_per_pack, notes, created_at, pack_weight, brand, supplier_part_number, supplier_id, secondary_supplier_id, ordering_url, processing_ratio, raw_meat_tray_capacity_kg, category, stock_check_enabled, stock_check_frequency, stock_check_day, min_cooking_temp_c, estimated_cook_time_min, oven_temp_c, steam_pct, surplus_percent, shelf_life_days, kanban_enabled, kanban_quantity, kanban_unit, kanban_order_amount, perishable, pallet_size, energy_kj, energy_kcal, fat, saturates, carbohydrate, sugars, protein, salt, label_declaration, allergens, fibre, prep_weight_mode, qr_code_url, is_bottle, bottle_size) FROM stdin;
26	Passata (Rodolfi)	kg	16.5000	Base	2026-03-19 09:57:55.969351	10.0000	\N	\N	10	\N	\N	1.0000	\N	sauce	f	daily	\N	\N	\N	\N	\N	700.00	\N	t	0.0000	weight	\N	t	\N	109.00	26.00	0.10	0.00	4.30	3.80	1.30	0.04	Tomato Passata (Tomatoes)	[]	1.00	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-26.png	f	\N
22	Pork	kg	5.8500	Meat	2026-03-19 09:57:55.944889	1.0000	\N	\N	3	\N	\N	0.7300	6.0000	raw_meat	t	daily	\N	75.00	180	155	70	30.00	\N	f	0.0000	weight	\N	t	\N	519.00	123.00	4.00	1.40	0.00	0.00	21.20	0.16	Pork	[]	0.00	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-22.png	f	\N
210	Beef Burgers	kg	6.7900	\N	2026-03-23 17:26:33.316819	1.0000	NFS	\N	\N	\N	\N	\N	2.1000	raw_meat	t	daily	\N	70.00	30	170	50	10.00	\N	f	0.0000	weight	\N	t	\N	1050.00	252.00	17.30	7.20	4.80	0.50	19.50	1.20	Beef Burger (Beef, Seasoning, Salt)	[]	0.50	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-210.png	f	\N
18	Basil	g	1.7900	Herbs and Spices	2026-03-19 09:57:55.919411	100.0000	\N	\N	5	\N	\N	0.6016	\N	vegetable	t	daily	\N	\N	\N	\N	\N	125.00	\N	f	0.0000	weight	\N	t	\N	96.00	23.00	0.60	0.00	1.30	0.30	3.20	0.01	Basil	[]	1.60	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-18.png	f	\N
62	Dried Thyme	g	3.0900	Herbs and Spices	2026-03-19 09:57:56.099058	180.0000	\N	\N	9	\N	\N	1.0000	\N	herb	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	1138.00	276.00	7.40	2.70	26.90	1.70	9.10	0.06	Dried Thyme	[]	37.00	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-62.png	f	\N
12	Red peppers	kg	13.9500	Vegetables	2026-03-19 09:57:55.900048	5.0000	\N	\N	5	1	\N	0.8470	\N	vegetable	t	daily	\N	\N	\N	\N	\N	215.00	5	f	0.0000	weight	\N	t	\N	130.00	31.00	0.30	0.00	6.00	4.20	1.00	0.01	Red Pepper	[]	2.10	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-12.png	f	\N
209	Sysco Classic Grated Monterey Jack Cheese	kg	6.9900	\N	2026-03-23 17:21:22.760808	1.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	3.0000	weight	4.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	Monterey Jack Cheese (Milk, Salt, Cultures, Enzyme)	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-209.png	f	\N
56	Burger Meat	kg	9.9000	Meat	2026-03-19 09:57:56.076373	1.0000	\N	\N	3	\N	\N	0.7000	2.9000	raw_meat	t	daily	\N	70.00	30	150	70	250.00	\N	f	0.0000	weight	\N	t	\N	893.00	214.00	15.20	6.30	0.00	0.00	19.30	0.18	Beef	[]	0.00	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-56.png	f	\N
204	Minced Beef	kg	13.9100	\N	2026-03-19 09:57:56.504417	2.5000	\N	F 32680	1	\N	\N	0.8500	2.5000	raw_meat	f	daily	\N	70.00	30	170	70	10.00	\N	t	0.0000	weight	\N	t	\N	893.00	214.00	15.20	6.30	0.00	0.00	19.30	0.18	Minced Beef	[]	0.00	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-204.png	f	\N
20	Goats Cheese	kg	13.9500	Cheese	2026-03-19 09:57:55.935332	1.0000	\N	\N	\N	\N	\N	1.0000	\N	cheese	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-20.png	f	\N
53	Pomodori Peeled Plum Tomatoes	kg	2.6400	Vegetables	2026-03-19 09:57:56.067442	2.5000	\N	\N	5	\N	\N	1.0000	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-53.png	f	\N
67	Meahs Tikka Sauce	kg	18.9900	Sauces	2026-03-19 09:57:56.115016	3.0000	\N	\N	9	\N	\N	1.0000	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-67.png	f	\N
131	Dried Cranberries	kg	10.8900	\N	2026-03-19 09:57:56.313597	1.0000	\N	\N	5	\N	\N	1.0000	\N	herb	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-131.png	f	\N
203	Honey Sriracha	kg	40.0000	\N	2026-03-19 09:57:56.502483	5.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	4.0000	weight	6.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-203.png	f	\N
49	Hoisin Sauce	kg	7.7600	\N	2026-03-19 09:57:56.049366	2.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	9.0000	weight	10.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	Hoisin Sauce (Water, Sugar, Soya Beans, Modified Corn Starch, Salt, Sesame Oil, Garlic, Chilli, Spices)	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-49.png	f	\N
139	American Mustard	kg	27.9600	\N	2026-03-19 09:57:56.339808	11.6000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	2.0000	weight	2.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	American Mustard (Water, Spirit Vinegar, Mustard Seed, Salt, Turmeric, Paprika, Garlic Powder)	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-139.png	f	\N
166	Garlic Confit	kg	22.7400	\N	2026-03-19 09:57:56.406485	2.7250	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	2.0000	weight	5.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-166.png	f	\N
21	Chicken	kg	5.3900	\N	2026-03-19 09:57:55.941535	1.0000	\N	\N	\N	\N	\N	\N	\N	\N	t	daily	\N	\N	\N	\N	\N	10.00	\N	t	1.0000	weight	2000.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-21.png	f	\N
46	Mayonnaise	kg	24.1300	\N	2026-03-19 09:57:56.039926	10.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	3.0000	weight	4.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-46.png	f	\N
55	Lemon Juice (Quick lemon)	kg	2.4400	\N	2026-03-19 09:57:56.073115	1.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	6.0000	weight	6.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-55.png	f	\N
58	Red Onion Chutney	kg	9.4800	\N	2026-03-19 09:57:56.081224	1.2500	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	12.0000	pack	13.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	Red Onion Chutney	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-58.png	f	\N
61	Grated matture Cheddar	kg	5.4300	Cheese	2026-03-19 09:57:56.095469	1.0000	\N	\N	1	\N	\N	1.0000	\N	cheese	f	daily	\N	\N	\N	\N	\N	200.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-61.png	f	\N
41	Paprika	g	4.1500	\N	2026-03-19 09:57:56.026785	550.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	6.0000	weight	6.0000	t	\N	1172.00	282.00	12.90	2.10	34.80	10.30	14.10	0.08	Paprika	[]	34.90	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-41.png	f	\N
134	TCK Roasted Red peppers	kg	13.9500	\N	2026-03-19 09:57:56.321481	1.0000	\N	\N	17	\N	\N	0.5100	\N	vegetable	f	daily	\N	\N	\N	\N	\N	10.00	5	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-134.png	f	\N
135	TCK Roasted Mushroons	kg	10.9500	\N	2026-03-19 09:57:56.325259	2.5000	\N	\N	17	\N	\N	0.6000	\N	vegetable	f	daily	\N	\N	\N	\N	\N	10.00	5	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-135.png	f	\N
52	Ghekins	kg	3.8900	Vegetables	2026-03-19 09:57:56.063129	1.3500	\N	\N	9	\N	\N	1.0000	\N	vegetable	f	daily	\N	\N	\N	\N	\N	10.00	5	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-52.png	f	\N
68	Green Peppers	kg	13.9500	Vegetables	2026-03-19 09:57:56.117246	5.0000	\N	\N	5	\N	\N	1.0000	\N	vegetable	f	daily	\N	\N	\N	\N	\N	10.00	5	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-68.png	f	\N
136	Cauliflower	kg	29.5000	\N	2026-03-19 09:57:56.328467	5.0000	\N	\N	5	\N	\N	1.0000	\N	vegetable	f	daily	\N	\N	\N	\N	\N	10.00	5	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-136.png	f	\N
29	Artichoke (drained weight)	g	3.0000	Vegetables	2026-03-19 09:57:55.97857	540.0000	\N	\N	\N	\N	\N	1.0000	\N	vegetable	f	daily	\N	\N	\N	\N	\N	10.00	5	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-29.png	f	\N
138	Roasted Red Peppers	kg	12.2900	\N	2026-03-19 09:57:56.333345	2.2000	\N	\N	5	\N	\N	0.9500	\N	vegetable	f	daily	\N	\N	\N	\N	\N	10.00	5	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-138.png	f	\N
78	Braising Beef	kg	9.9000	Meat	2026-03-19 09:57:56.145629	1.0000	\N	\N	1	\N	\N	1.0000	3.5000	raw_meat	t	daily	\N	70.00	240	155	70	10.00	\N	f	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-78.png	f	\N
54	Minced Garlic	kg	5.1900	Herbs and Spices	2026-03-19 09:57:56.070288	1.3600	\N	\N	\N	\N	\N	1.0000	\N	spice	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-54.png	f	\N
50	White onions	kg	16.5000	\N	2026-03-19 09:57:56.052721	20.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	5	t	5.0000	weight	5.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-50.png	f	\N
122	Chestnut Mushrooms	kg	10.9500	\N	2026-03-19 09:57:56.287285	2.2700	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	5	t	6.0000	weight	7.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-122.png	f	\N
24	Duck	kg	11.9900	\N	2026-03-19 09:57:55.956234	1.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	50.0000	weight	50.0000	t	\N	769.00	184.00	10.00	3.50	0.00	0.00	23.50	0.15	Duck	[]	0.00	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-24.png	f	\N
129	Peeled Shallots	kg	9.2000	\N	2026-03-19 09:57:56.308289	1.0000	\N	\N	5	\N	\N	0.9500	\N	vegetable	f	daily	\N	\N	\N	\N	\N	10.00	5	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-129.png	f	\N
93	Carrots (Grated)	kg	2.7500	\N	2026-03-19 09:57:56.19813	1.0000	\N	\N	5	\N	\N	1.0000	\N	vegetable	f	daily	\N	\N	\N	\N	\N	10.00	5	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-93.png	f	\N
99	Carrots (Diced)	kg	2.7500	\N	2026-03-19 09:57:56.217723	1.0000	\N	\N	5	\N	\N	1.0000	\N	vegetable	f	daily	\N	\N	\N	\N	\N	10.00	5	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-99.png	f	\N
107	Chargrilled peppers	kg	12.7000	\N	2026-03-19 09:57:56.240056	1.9000	\N	\N	10	\N	\N	0.5900	\N	vegetable	f	daily	\N	\N	\N	\N	\N	10.00	5	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-107.png	f	\N
108	Chargrilled Aubergines	kg	12.7000	\N	2026-03-19 09:57:56.242598	1.9000	\N	\N	10	\N	\N	0.5300	\N	vegetable	f	daily	\N	\N	\N	\N	\N	10.00	5	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-108.png	f	\N
109	Chargrilled Artichokes	kg	10.9800	\N	2026-03-19 09:57:56.245225	1.0000	\N	\N	5	\N	\N	0.9500	\N	vegetable	f	daily	\N	\N	\N	\N	\N	10.00	5	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-109.png	f	\N
133	Baby Spinach	kg	12.4900	\N	2026-03-19 09:57:56.318677	2.0000	\N	\N	5	\N	\N	1.0000	\N	vegetable	f	daily	\N	\N	\N	\N	\N	10.00	5	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-133.png	f	\N
30	Jalapenos (Drained weight)	kg	5.6900	Vegetables	2026-03-19 09:57:55.981594	3.0000	\N	\N	5	\N	\N	1.0000	\N	vegetable	f	daily	\N	\N	\N	\N	\N	10.00	5	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-30.png	f	\N
27	Demerrera Sugar	kg	7.8500	Herbs and Spices	2026-03-19 09:57:55.971711	3.0000	\N	\N	9	\N	\N	1.0000	\N	other	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	1630.00	389.00	0.00	0.00	97.30	97.30	0.00	0.01	Demerara Sugar	[]	0.00	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-27.png	f	\N
28	Balsamic Glaze	g	2.6200	\N	2026-03-19 09:57:55.973741	500.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	10.0000	weight	11.0000	t	\N	754.00	178.00	0.00	0.00	43.00	38.00	0.50	0.08	Balsamic Glaze (Balsamic Vinegar of Modena (Wine Vinegar, Grape Must), Glucose-Fructose Syrup)	[]	0.00	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-28.png	f	\N
32	Flour (00)	kg	16.6900	Dough	2026-03-19 09:57:55.994434	15.0000	Caputo Blue	\N	2	\N	www.adimaria.co.uk	1.0000	\N	dough	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	1468.00	348.00	1.20	0.20	73.30	1.70	11.50	0.00	Wheat Flour (Type 00)	[]	2.70	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-32.png	f	\N
163	Pineapple	kg	15.4100	\N	2026-03-19 09:57:56.398399	2.5000	\N	\N	1	\N	\N	1.0000	\N	vegetable	f	daily	\N	\N	\N	\N	\N	10.00	5	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-163.png	f	\N
59	Burger Sauce	kg	15.0000	\N	2026-03-19 09:57:56.086633	2.1000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	6.0000	weight	10.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	Burger Sauce	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-59.png	f	\N
14	Mushrooms	kg	8.2000	Vegetables	2026-03-19 09:57:55.906209	2.5000	\N	\N	5	\N	\N	1.0000	\N	vegetable	f	daily	\N	\N	\N	\N	\N	100.00	5	f	0.0000	weight	\N	t	\N	55.00	13.00	0.50	0.10	0.40	0.20	1.80	0.02	Mushrooms	[]	1.00	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-14.png	f	\N
206	Cheeky Gluten Free Crispy Fried Onions	kg	6.9100	\N	2026-03-23 17:09:49.528264	1.0000	Cheeky	136733	1	\N	https://www.brake.co.uk/dry-store/cooking-ingredients/herbs-spices-seasonings/blends-other-seasonings/cheeky-gluten-free-crispy-fried-onions/p/136733	\N	\N	vegetable	f	daily	\N	\N	\N	\N	\N	10.00	5	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	Crispy Fried Onions (Onion, Palm Oil, Rice Flour, Salt)	[]	\N	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-206.png	f	\N
19	Rosemary	g	1.7900	\N	2026-03-19 09:57:55.921892	100.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	250.00	\N	t	3.0000	weight	4.0000	t	\N	544.00	131.00	5.90	2.60	6.60	0.00	3.30	0.06	Rosemary	[]	14.10	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-19.png	f	\N
193	Pastrami (Sliced)	kg	20.9700	\N	2026-03-19 09:57:56.477812	1.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	25.0000	weight	25.0000	t	\N	560.00	133.00	4.80	1.60	2.00	1.80	21.00	2.50	Pastrami (Beef, Salt, Sugar, Spices, Smoke Flavouring)	[]	0.00	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-193.png	f	\N
25	Olive Oil	kg	39.9900	\N	2026-03-19 09:57:55.962684	5.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	5.0000	weight	5.0000	t	\N	3701.00	884.00	100.00	14.20	0.00	0.00	0.00	0.00	Olive Oil	[]	0.00	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-25.png	f	\N
31	Piri Piri Glaze (MRC)	kg	18.3900	\N	2026-03-19 09:57:55.98957	2.5000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	2.0000	weight	3.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	Piri Piri Glaze	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-31.png	f	\N
45	BBQ Sauce (lion sticky)	kg	7.3900	\N	2026-03-19 09:57:56.036939	2.2000	\N	\N	\N	\N	\N	\N	\N	\N	f	weekly	\N	\N	\N	\N	\N	10.00	\N	t	4.0000	pack	6.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	BBQ Sauce (Sugar, Tomato Purée, Spirit Vinegar, Molasses, Modified Maize Starch, Salt, Mustard Flour, Spices, Garlic Powder, Smoke Flavouring)	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-45.png	f	\N
3	Salt	kg	7.8500	\N	2026-03-17 17:27:12.929118	6.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	1.0000	weight	2.0000	t	\N	0.00	0.00	0.00	0.00	0.00	0.00	0.00	99.80	Salt	[]	0.00	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-3.png	f	\N
33	Yeast	g	4.2500	Dough	2026-03-19 09:57:55.998322	500.0000	\N	\N	10	\N	\N	1.0000	\N	dough	f	daily	\N	\N	\N	\N	\N	1500.00	\N	t	0.0000	weight	\N	t	\N	1296.00	310.00	4.00	0.60	41.20	0.00	40.40	0.12	Yeast	[]	26.90	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-33.png	f	\N
36	Sliced Black Olives	g	0.7500	Vegetables	2026-03-19 09:57:56.008924	170.0000	\N	\N	\N	\N	\N	1.0000	\N	vegetable	f	daily	\N	\N	\N	\N	\N	10.00	5	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-36.png	f	\N
141	Broccoli (prepared)	kg	17.5000	\N	2026-03-19 09:57:56.344939	2.5000	\N	\N	5	\N	\N	0.7400	\N	vegetable	f	daily	\N	\N	\N	\N	\N	10.00	5	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-141.png	f	\N
57	Gherkin (drained weight)	kg	7.0400	Vegetables	2026-03-19 09:57:56.078702	1.3800	\N	\N	9	1	\N	1.0000	\N	vegetable	f	daily	\N	\N	\N	\N	\N	10.00	5	t	0.0000	weight	\N	t	\N	67.00	16.00	0.10	0.00	2.00	1.10	0.50	1.60	Gherkin	[]	1.00	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-57.png	f	\N
38	Garlic Granules	g	6.1200	\N	2026-03-19 09:57:56.016815	700.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	3.0000	weight	1.0000	t	\N	1389.00	331.00	0.70	0.10	72.70	2.40	16.60	0.08	Garlic Granules	[]	9.00	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-38.png	f	\N
69	Greek Yoghurt	kg	7.2500	Dairy	2026-03-19 09:57:56.119365	1.0000	\N	\N	9	\N	\N	1.0000	\N	dairy	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-69.png	f	\N
51	Rib Meat	kg	15.0000	Meat	2026-03-19 09:57:56.058752	1.0000	\N	\N	\N	\N	\N	1.0000	\N	cooked_meat	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-51.png	f	\N
149	Hoisin Sauce (Knorr)	kg	22.5800	\N	2026-03-19 09:57:56.36417	2.2000	Knorrs	\N	23	\N	\N	1.0000	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-149.png	f	\N
170	Ranch	kg	9.5700	\N	2026-03-19 09:57:56.415851	2.2700	Lion	\N	1	\N	\N	0.9700	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-170.png	f	\N
164	Ham Hock	kg	9.9900	\N	2026-03-19 09:57:56.400925	1.0000	\N	\N	1	\N	\N	1.0000	\N	cooked_meat	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-164.png	f	\N
111	Corn Starch	kg	13.7200	\N	2026-03-19 09:57:56.253531	5.0000	\N	\N	\N	\N	https://www.buywholefoodsonline.co.uk/cornflour-corn-starch.html	1.0000	\N	other	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-111.png	f	\N
11	Pepperoni	kg	10.2800	\N	2026-03-19 09:57:55.88603	1.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	4.0000	weight	4.0000	t	\N	1979.00	476.00	40.20	14.80	3.10	1.10	24.80	3.60	Pepperoni (Pork, Spices, Salt, Dextrose, Garlic Powder, Smoke Flavouring)	[]	0.00	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-11.png	f	\N
191	Diced Chicken fillet	kg	16.5900	\N	2026-03-19 09:57:56.471088	2.5000	\N	C 70946	1	\N	https://www.brake.co.uk/meat-poultry/chilled-butchered-poultry/chicken/chicken-mince-diced-strips/prime-meats-british-red-tractor-diced-chicken-breast/p/70946?term=diced&#x20;chicken&#x20;fillet	0.8700	4.0000	raw_meat	t	daily	\N	75.00	30	170	70	30.00	\N	f	0.0000	weight	\N	t	\N	460.00	110.00	1.30	0.30	0.00	0.00	23.10	0.15	Chicken Breast	[]	0.00	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-191.png	f	\N
40	Course Black Pepper	g	6.2600	\N	2026-03-19 09:57:56.022548	500.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	3.0000	weight	6.0000	t	\N	1059.00	255.00	3.30	1.40	38.30	0.60	10.40	0.05	Cracked Black Pepper	[]	25.30	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-40.png	f	\N
202	Garlic Butter	g	1.9600	\N	2026-03-19 09:57:56.499856	271.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	1.0000	weight	4.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-202.png	f	\N
39	Ground black pepper	g	6.1200	\N	2026-03-19 09:57:56.019111	500.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	3.0000	weight	4.0000	t	\N	1059.00	255.00	3.30	1.40	38.30	0.60	10.40	0.05	Black Pepper	[]	25.30	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-39.png	f	\N
7	Fior Di Latte	kg	49.9900	\N	2026-03-18 09:14:31.112967	10.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	550.00	\N	t	40.0000	weight	\N	t	\N	1132.00	271.00	17.70	11.10	3.10	1.40	25.30	0.63	Fior Di Latte Cheese (Milk)	[]	0.00	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-7.png	f	\N
72	Red Chillis	kg	33.6500	Vegetables	2026-03-19 09:57:56.12722	3.0000	\N	\N	5	\N	\N	1.0000	\N	vegetable	f	daily	\N	\N	\N	\N	\N	200.00	5	f	0.0000	weight	\N	t	\N	167.00	40.00	0.40	0.10	6.10	3.40	1.90	0.02	Red Chilli	[]	1.50	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-72.png	f	\N
17	Tomatoes	kg	10.9500	Vegetables	2026-03-19 09:57:55.916023	6.0000	\N	\N	5	\N	\N	0.8744	\N	vegetable	f	daily	\N	\N	\N	\N	\N	10.00	5	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-17.png	f	\N
16	Courgettes	kg	10.9500	Vegetables	2026-03-19 09:57:55.91239	5.0000	\N	\N	5	\N	\N	0.9569	\N	vegetable	f	daily	\N	\N	\N	\N	\N	215.00	5	f	0.0000	weight	\N	t	\N	71.00	17.00	0.30	0.10	1.80	1.70	1.20	0.02	Courgette	[]	1.00	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-16.png	f	\N
13	Red Onions	kg	3.0500	Vegetables	2026-03-19 09:57:55.902781	1.0000	\N	\N	5	\N	\N	1.0000	\N	vegetable	t	daily	\N	\N	\N	\N	\N	10.00	5	f	0.0000	weight	\N	t	\N	163.00	39.00	0.10	0.00	7.90	5.60	1.20	0.01	Red Onion	[]	1.70	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-13.png	f	\N
15	Spring Onions	kg	5.8000	Vegetables	2026-03-19 09:57:55.908692	1.0000	\N	\N	5	\N	\N	0.8700	\N	vegetable	f	daily	\N	\N	\N	\N	\N	100.00	5	f	0.0000	weight	\N	t	\N	138.00	33.00	0.20	0.00	5.70	2.80	1.80	0.04	Spring Onion	[]	2.60	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-15.png	f	\N
172	Chickpeas	kg	3.4500	\N	2026-03-19 09:57:56.420477	1.5000	Royal Crown	\N	1	\N	\N	1.0000	\N	vegetable	f	daily	\N	\N	\N	\N	\N	10.00	5	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-172.png	f	\N
66	Dried Parsley	g	2.7400	Herbs and Spices	2026-03-19 09:57:56.112139	120.0000	\N	\N	9	\N	\N	1.0000	\N	herb	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	1132.00	271.00	5.50	1.00	28.60	7.30	26.60	0.45	Dried Parsley	[]	26.70	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-66.png	f	\N
60	Garlic Puree	kg	4.2300	Herbs and Spices	2026-03-19 09:57:56.091913	1.0000	\N	\N	9	\N	\N	1.0000	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-60.png	f	\N
155	Szechuan Concentrated Sauce	kg	12.1600	\N	2026-03-19 09:57:56.378625	1.0000	\N	\N	1	\N	\N	1.0000	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-155.png	f	\N
158	Garlic Puree (Brakes)	kg	10.2200	\N	2026-03-19 09:57:56.386194	1.2000	\N	\N	1	\N	\N	1.0000	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-158.png	f	\N
153	Smoked Bacon Lardons	kg	55.4300	\N	2026-03-19 09:57:56.373385	10.0000	\N	\N	1	\N	\N	0.5500	\N	cooked_meat	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-153.png	f	\N
154	Diced Beef	kg	25.8400	\N	2026-03-19 09:57:56.37607	2.5000	\N	C 136642	1	\N	\N	1.0000	\N	raw_meat	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-154.png	f	\N
195	Red Leicester Cheese	kg	24.9800	\N	2026-03-19 09:57:56.482816	2.5000	\N	9827	9	\N	\N	1.0000	\N	cheese	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-195.png	f	\N
171	Mango Chutney	kg	5.3900	\N	2026-03-19 09:57:56.418178	1.5000	Geetas	\N	1	\N	\N	0.9700	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-171.png	f	\N
169	Santa Maria BBQ Sauce	kg	6.1100	\N	2026-03-19 09:57:56.413963	1.1000	Santa Maria	\N	1	\N	\N	0.9700	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-169.png	f	\N
190	Cranberry Sauce	kg	12.9500	\N	2026-03-19 09:57:56.468221	2.5000	\N	A 100357	1	\N	\N	1.0000	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-190.png	f	\N
168	Chipotle paste	g	10.1400	\N	2026-03-19 09:57:56.411448	750.0000	Santa Maria	\N	1	\N	\N	1.0000	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-168.png	f	\N
90	Turmeric	g	4.5800	\N	2026-03-19 09:57:56.185181	500.0000	\N	\N	9	\N	\N	1.0000	\N	spice	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-90.png	f	\N
173	Curry Powder	g	7.9100	\N	2026-03-19 09:57:56.423186	500.0000	Sysco	\N	1	\N	\N	1.0000	\N	spice	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-173.png	f	\N
179	Sirloin Steak	kg	33.2800	\N	2026-03-19 09:57:56.437659	1.7000	\N	C 136847	1	\N	\N	0.8000	\N	raw_meat	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-179.png	f	\N
37	Tomato Puree (paste)	g	2.4300	\N	2026-03-19 09:57:56.012686	800.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	700.00	\N	t	3.0000	weight	\N	t	\N	347.00	82.00	0.40	0.10	13.10	11.50	4.30	0.17	Tomato Purée (Tomatoes)	[]	4.10	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-37.png	f	\N
34	Feta	g	13.4900	\N	2026-03-19 09:57:56.001301	900.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	4.0000	weight	6.0000	t	\N	1103.00	264.00	21.30	14.90	1.50	1.50	17.20	2.50	Feta Cheese (Milk)	[]	0.00	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-34.png	f	\N
75	Dried Basil	g	2.9200	\N	2026-03-19 09:57:56.136062	150.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	3.0000	weight	1.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-75.png	f	\N
144	Dijon Mustard	kg	13.0100	\N	2026-03-19 09:57:56.352142	2.2700	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	1.0000	weight	1.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-144.png	f	\N
95	Tap Water	kg	0.0000	\N	2026-03-19 09:57:56.203503	1.0000	\N	\N	17	\N	\N	1.0000	\N	other	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	0.00	0.00	0.00	0.00	0.00	0.00	0.00	0.00	Water	[]	0.00	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-95.png	f	\N
79	Calzone Dough	kg	0.8500	\N	2026-03-19 09:57:56.152815	1.0000	\N	\N	17	\N	\N	1.0000	\N	dough	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	Calzone Dough	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-79.png	f	\N
101	Yangnyeom Korean Sauce	kg	4.3700	\N	2026-03-19 09:57:56.223836	1.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	300.0000	weight	600.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-101.png	f	\N
98	Plain Flour	kg	11.4900	\N	2026-03-19 09:57:56.214614	16.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	760.00	\N	t	1.0000	weight	1.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-98.png	f	\N
77	Matture Cheddar	kg	14.9500	Dairy	2026-03-19 09:57:56.142376	2.0000	\N	\N	5	9	\N	1.0000	\N	cheese	f	daily	\N	\N	\N	\N	\N	10.00	\N	f	0.0000	weight	\N	t	\N	1725.00	416.00	34.90	21.70	0.10	0.10	25.40	1.80	Mature Cheddar Cheese (Milk)	[]	0.00	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-77.png	f	\N
115	Icing Sugar	kg	7.2300	\N	2026-03-19 09:57:56.267399	3.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	1.0000	weight	2.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-115.png	f	\N
73	Ground Cumin	g	4.6200	\N	2026-03-19 09:57:56.130343	400.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	6.0000	weight	6.0000	t	\N	1567.00	375.00	22.30	1.50	33.70	2.30	17.80	0.17	Ground Cumin	[]	10.50	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-73.png	f	\N
85	Panko Breadcrumbs	kg	4.5400	\N	2026-03-19 09:57:56.170751	1.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	1.0000	weight	5.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-85.png	f	\N
103	Nacho Cheese Sauce	kg	20.6300	\N	2026-03-19 09:57:56.229835	1.5640	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	20.0000	weight	30.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-103.png	f	\N
81	Spicy Base	kg	2.8300	\N	2026-03-19 09:57:56.158236	1.0000	\N	\N	17	\N	\N	1.0000	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-81.png	f	\N
92	Hoisin Sauce (Blue Dragon)	kg	6.4600	\N	2026-03-19 09:57:56.194589	1.2500	Blue Dragon	\N	19	\N	\N	1.0000	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-92.png	f	\N
123	Mushroom Duxelle	kg	11.4700	\N	2026-03-19 09:57:56.289264	1.3250	\N	\N	17	\N	\N	1.0000	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-123.png	f	\N
74	Ground Nutmeg	g	13.5600	Herbs and Spices	2026-03-19 09:57:56.133491	500.0000	\N	\N	9	\N	\N	1.0000	\N	spice	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-74.png	f	\N
121	Beef Welly Mix	kg	10.1300	\N	2026-03-19 09:57:56.284653	1.0000	\N	\N	17	\N	\N	1.0000	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-121.png	f	\N
145	Gorgonzola Dolce	kg	15.1200	\N	2026-03-19 09:57:56.354852	1.6000	\N	\N	10	\N	\N	1.0000	\N	cheese	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-145.png	f	\N
71	Pancetta	kg	11.5000	\N	2026-03-19 09:57:56.124611	1.0000	\N	\N	\N	\N	\N	0.6600	\N	cooked_meat	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-71.png	f	\N
117	Red Cooking Wine	kg	6.9500	\N	2026-03-19 09:57:56.27231	5.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	3.0000	weight	4.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-117.png	f	\N
113	Skimmed Milk Powder	kg	11.5500	\N	2026-03-19 09:57:56.259018	2.0000	\N	\N	9	\N	\N	1.0000	\N	dairy	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-113.png	f	\N
82	Buttermilk Fried Chicken Strip	kg	0.6900	\N	2026-03-19 09:57:56.160923	1.0000	\N	\N	17	\N	\N	1.0000	\N	cooked_meat	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-82.png	f	\N
124	Spicy Chicken	kg	10.0000	\N	2026-03-19 09:57:56.292152	1.0000	\N	\N	\N	\N	\N	0.8000	\N	cooked_meat	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-124.png	f	\N
114	Egg White Powder	kg	29.9500	\N	2026-03-19 09:57:56.264915	1.0000	\N	\N	22	\N	\N	1.0000	\N	other	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-114.png	f	\N
76	Beef Bouillion	kg	19.9600	Herbs and Spices	2026-03-19 09:57:56.139345	1.0000	\N	\N	9	\N	\N	1.0000	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-76.png	f	\N
127	Cranberry	kg	8.9000	\N	2026-03-19 09:57:56.300232	2.5000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	2.0000	weight	4.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-127.png	f	\N
94	Chicken Boullion	kg	15.9100	\N	2026-03-19 09:57:56.200793	1.0200	\N	\N	9	\N	\N	1.0000	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-94.png	f	\N
106	Branston Pickle	kg	14.5500	\N	2026-03-19 09:57:56.237465	2.5500	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	4.0000	weight	4.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-106.png	f	\N
83	Whole Milk	kg	2.7900	\N	2026-03-19 09:57:56.16295	2.2700	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	0.00	\N	t	1.0000	weight	1.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-83.png	f	\N
126	Red Onion Gravy	kg	2.0900	\N	2026-03-19 09:57:56.297458	1.0000	\N	\N	17	\N	\N	0.9400	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-126.png	f	\N
146	Cider Vinegar	kg	8.5300	\N	2026-03-19 09:57:56.356792	5.0000	\N	\N	23	\N	\N	1.0000	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-146.png	f	\N
132	Riccota	kg	10.1300	\N	2026-03-19 09:57:56.316249	1.5000	\N	\N	9	\N	\N	1.0000	\N	cheese	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-132.png	f	\N
100	Baby Back Pork Ribs	kg	72.0000	\N	2026-03-19 09:57:56.219903	10.0000	\N	\N	\N	\N	\N	1.0000	\N	raw_meat	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-100.png	f	\N
42	Chilli powder	g	4.4500	\N	2026-03-19 09:57:56.02995	400.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	3.0000	weight	1.0000	t	\N	1172.00	282.00	14.30	2.50	29.30	7.20	13.50	0.77	Chilli Powder	[]	34.80	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-42.png	f	\N
205	Chicken Seasoning Mix	kg	21.3800	\N	2026-03-19 09:57:56.507293	3.0000	\N	\N	17	\N	\N	1.0000	\N	seasoning	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	Chicken Seasoning Mix	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-205.png	f	\N
97	Honey (CR)	g	3.3900	\N	2026-03-19 09:57:56.212286	680.0000	Country Range	\N	9	\N	\N	0.9500	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	1381.00	329.00	0.00	0.00	81.50	81.50	0.30	0.01	Honey	[]	0.00	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-97.png	f	\N
128	Smoked paprika	g	7.2500	\N	2026-03-19 09:57:56.305613	750.0000	\N	\N	9	\N	\N	1.0000	\N	spice	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	1172.00	282.00	12.90	2.10	34.80	10.30	14.10	0.08	Smoked Paprika	[]	34.90	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-128.png	f	\N
112	Potato Starch	kg	11.6900	\N	2026-03-19 09:57:56.255838	2.0000	\N	\N	\N	\N	https://www.buywholefoodsonline.co.uk/organic-potato-starch.html	1.0000	\N	other	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-112.png	f	\N
208	Streky Bacon	kg	9.9900	\N	2026-03-23 17:11:02.220816	1.0000	\N	NFS	\N	\N	\N	\N	\N	other	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	1156.00	278.00	22.30	8.20	0.50	0.50	18.50	2.90	Streaky Bacon (Pork Belly, Salt, Sugar, Preservative: Sodium Nitrite)	[]	0.00	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-208.png	f	\N
35	Chives	g	0.7000	Herbs and Spices	2026-03-19 09:57:56.004192	30.0000	\N	\N	\N	\N	\N	1.0000	\N	herb	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-35.png	f	\N
187	Turkey Saddle	kg	31.0000	\N	2026-03-19 09:57:56.461253	3.5000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	4.0000	weight	5.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-187.png	f	\N
119	Fresh Thyme	g	1.7900	\N	2026-03-19 09:57:56.27852	100.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	3.0000	weight	3.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-119.png	f	\N
137	Cinnamon	g	7.5700	\N	2026-03-19 09:57:56.330725	450.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	50.0000	weight	100.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-137.png	f	\N
192	Beef Bouillon Paste	kg	13.7400	\N	2026-03-19 09:57:56.473571	1.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	2.0000	weight	3.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-192.png	f	\N
200	Beef Short Rib (Best Butchers)	kg	12.5000	\N	2026-03-19 09:57:56.494306	1.0000	\N	\N	\N	\N	\N	0.5000	\N	raw_meat	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-200.png	f	\N
148	Balsamic Vinegar	kg	14.7500	\N	2026-03-19 09:57:56.362183	5.0000	\N	\N	5	\N	\N	1.0000	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-148.png	f	\N
159	Chilli Oil	kg	18.0000	\N	2026-03-19 09:57:56.388789	1.0200	\N	\N	22	\N	\N	1.0000	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-159.png	f	\N
177	G's Piri Piri Sauce	kg	7.5200	\N	2026-03-19 09:57:56.432411	1.0000	\N	\N	17	\N	\N	1.0000	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-177.png	f	\N
152	Tikka Paste	kg	10.9400	\N	2026-03-19 09:57:56.3714	1.1000	\N	\N	1	\N	\N	1.0000	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-152.png	f	\N
157	Rice Vinegar	kg	12.3000	\N	2026-03-19 09:57:56.383696	3.0000	\N	\N	1	\N	\N	1.0000	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-157.png	f	\N
183	Red Wine Gravy (2025)	g	0.7900	\N	2026-03-19 09:57:56.449034	87.0000	\N	\N	17	\N	\N	1.0000	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-183.png	f	\N
174	Tajin Classico Seasoning with Lime	g	6.2300	\N	2026-03-19 09:57:56.425592	400.0000	Tajin	\N	22	\N	\N	1.0000	\N	spice	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-174.png	f	\N
151	Diced Chicken Thigh	kg	19.6500	\N	2026-03-19 09:57:56.36903	2.5000	\N	\N	1	\N	\N	1.0000	\N	raw_meat	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-151.png	f	\N
156	Beef Strips	kg	36.5700	\N	2026-03-19 09:57:56.38095	2.5000	\N	\N	1	\N	\N	1.0000	\N	raw_meat	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-156.png	f	\N
160	Cream Cheese	kg	17.6300	\N	2026-03-19 09:57:56.391659	2.0000	\N	\N	1	\N	\N	1.0000	\N	cheese	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-160.png	f	\N
167	Jerk BBQ Sauce	kg	8.9200	\N	2026-03-19 09:57:56.408827	1.0000	\N	\N	1	\N	\N	0.9700	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-167.png	f	\N
165	Bechemel (Macphie)	kg	38.3500	\N	2026-03-19 09:57:56.403549	10.0000	\N	A 9036	1	\N	\N	0.9800	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-165.png	f	\N
176	Red Wine Vinegar	kg	10.7200	\N	2026-03-19 09:57:56.429958	5.0000	\N	\N	1	\N	\N	1.0000	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-176.png	f	\N
84	Spicy Breading	kg	56.1400	\N	2026-03-19 09:57:56.167958	7.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	3.0000	weight	6.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-84.png	f	\N
48	Crushed chillis	g	5.2600	Herbs and Spices	2026-03-19 09:57:56.045051	300.0000	\N	\N	9	\N	\N	1.0000	\N	spice	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-48.png	f	\N
186	BBQ Shredded Turkey & Cranberry	g	4.1300	\N	2026-03-19 09:57:56.455944	500.0000	\N	F 150200	1	\N	\N	1.0000	\N	cooked_meat	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-186.png	f	\N
184	Sirloin Steak Center Cut	kg	18.2100	\N	2026-03-19 09:57:56.451326	1.1350	\N	C 5010975	1	\N	\N	0.5550	\N	raw_meat	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-184.png	f	\N
178	Lime Juice	kg	5.1000	\N	2026-03-19 09:57:56.435093	1.0000	Village Press	\N	1	\N	\N	1.0000	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-178.png	f	\N
201	Knorr Korma Sauce	kg	11.5400	\N	2026-03-19 09:57:56.497135	1.1000	\N	A 85659	1	\N	\N	0.9800	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-201.png	f	\N
44	Mixed Herbs	g	3.0200	\N	2026-03-19 09:57:56.034452	150.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	3.0000	weight	3.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-44.png	f	\N
87	Onion Powder	kg	14.8900	\N	2026-03-19 09:57:56.175751	2.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	6.0000	weight	6.0000	t	\N	1431.00	341.00	1.00	0.20	79.10	6.60	10.40	0.08	Onion Powder	[]	15.20	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-87.png	f	\N
89	Madras Curry Powder	g	3.4700	\N	2026-03-19 09:57:56.18154	450.0000	\N	\N	9	\N	\N	1.0000	\N	spice	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-89.png	f	\N
194	Macaroni	kg	4.6800	\N	2026-03-19 09:57:56.480224	3.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	1.0000	weight	2.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-194.png	f	\N
182	Prosciutto	kg	16.9900	\N	2026-03-19 09:57:56.446185	1.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	5.0000	weight	5.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-182.png	f	\N
65	Salted Butter	kg	68.5000	Dairy	2026-03-19 09:57:56.109144	10.0000	\N	\N	5	9	\N	1.0000	\N	dairy	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	3059.00	744.00	82.20	52.10	0.60	0.60	0.60	1.50	Salted Butter (Milk)	[]	0.00	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-65.png	f	\N
70	Special Sausage	kg	6.5000	Meat	2026-03-19 09:57:56.121856	1.0000	\N	\N	\N	\N	\N	0.8700	\N	raw_meat	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-70.png	f	\N
150	Hoisin Sauce (Bidfood Everyday)	kg	25.2100	\N	2026-03-19 09:57:56.366649	7.8000	Bidfood Everyday	\N	23	\N	\N	1.0000	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-150.png	f	\N
162	Parmesan	kg	23.1000	\N	2026-03-19 09:57:56.396496	1.0000	\N	\N	1	\N	\N	1.0000	\N	cheese	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-162.png	f	\N
110	Corn flour	kg	13.7200	\N	2026-03-19 09:57:56.25099	5.0000	\N	\N	\N	\N	https://www.buywholefoodsonline.co.uk/cornflour-corn-starch.html	1.0000	\N	other	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-110.png	f	\N
125	Streaky Bacon	kg	12.0000	\N	2026-03-19 09:57:56.294571	1.0000	\N	\N	\N	\N	\N	0.5200	\N	cooked_meat	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-125.png	f	\N
104	Philly Beef Mix	kg	13.9800	\N	2026-03-19 09:57:56.23231	1.0000	\N	\N	17	\N	\N	1.0000	\N	cooked_meat	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-104.png	f	\N
102	Basil puree	kg	14.7300	\N	2026-03-19 09:57:56.226744	1.0000	\N	\N	17	\N	\N	1.0000	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-102.png	f	\N
120	Beef Gravy Granules	kg	15.5500	\N	2026-03-19 09:57:56.281293	1.8000	\N	\N	9	\N	\N	1.0000	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-120.png	f	\N
143	Bechemel	kg	6.0700	\N	2026-03-19 09:57:56.349553	1.0000	\N	\N	9	\N	\N	0.9800	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-143.png	f	\N
147	Tamari Soy Sauce (UPF Free)	kg	24.9900	\N	2026-03-19 09:57:56.359609	6.0000	\N	\N	23	\N	\N	1.0000	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-147.png	f	\N
116	Marinade Spice Mix	kg	11.2800	\N	2026-03-19 09:57:56.270162	1.0000	\N	\N	17	\N	\N	1.0000	\N	spice	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-116.png	f	\N
142	Taleggio	kg	9.6900	\N	2026-03-19 09:57:56.34698	1.0000	\N	\N	10	\N	\N	1.0000	\N	cheese	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-142.png	f	\N
118	White Cooking Wine	kg	6.9500	\N	2026-03-19 09:57:56.275117	5.0000	\N	\N	10	\N	\N	1.0000	\N	other	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-118.png	f	\N
140	Vegetable Oil	kg	25.9900	\N	2026-03-19 09:57:56.342266	20.0000	KTC	\N	2	\N	\N	1.0000	\N	other	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-140.png	f	\N
91	Katsu Spice Mix	g	0.0000	\N	2026-03-19 09:57:56.188389	770.0000	\N	\N	17	\N	\N	1.0000	\N	spice	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-91.png	f	\N
196	Matture Cheddar Block	kg	32.6800	\N	2026-03-19 09:57:56.485436	4.7500	\N	C 71144	1	\N	\N	1.0000	\N	cheese	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-196.png	f	\N
63	Garlic Cloves fresh peeled	kg	5.4100	\N	2026-03-19 09:57:56.102925	1.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	5	t	7.0000	weight	10.0000	t	\N	620.00	149.00	0.50	0.10	29.30	1.00	6.40	0.04	Garlic	[]	2.10	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-63.png	f	\N
47	Mozzarella	kg	47.9900	\N	2026-03-19 09:57:56.042767	12.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	470.00	\N	t	72.0000	weight	\N	t	\N	1132.00	271.00	17.70	11.10	3.10	1.40	25.30	0.63	Mozzarella Cheese (Milk)	[]	0.00	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-47.png	f	\N
197	Evaporated Milk	g	1.1800	\N	2026-03-19 09:57:56.487853	410.0000	\N	A25002	1	\N	\N	1.0000	\N	dairy	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-197.png	f	\N
180	Red cooking wine (Sysco)	kg	37.9400	\N	2026-03-19 09:57:56.44039	10.0000	\N	A 25690	1	\N	\N	1.0000	\N	other	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-180.png	f	\N
105	Ham (sliced gammon)	g	4.4900	\N	2026-03-19 09:57:56.235213	530.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	15.0000	weight	20.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-105.png	f	\N
189	Pigs In Blankets	kg	15.5000	\N	2026-03-19 09:57:56.466382	1.0000	\N	F 120676	1	\N	\N	0.7900	\N	cooked_meat	f	daily	\N	\N	\N	\N	\N	30.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-189.png	f	\N
64	Frozen dough balls	kg	42.9900	\N	2026-03-19 09:57:56.105739	5.5850	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	1.0000	weight	3.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-64.png	f	\N
96	Dark Soy Sauce	kg	6.9900	\N	2026-03-19 09:57:56.209236	1.7500	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	4.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-96.png	f	\N
86	Garlic Powder	g	4.7000	\N	2026-03-19 09:57:56.173344	500.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	3.0000	weight	6.0000	t	\N	1389.00	331.00	0.70	0.10	72.70	2.40	16.60	0.08	Garlic Powder	[]	9.00	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-86.png	f	\N
185	Fillet steak (Sysco whole)	kg	64.2400	\N	2026-03-19 09:57:56.45371	2.1000	\N	C 133991	1	\N	\N	0.8000	\N	raw_meat	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-185.png	f	\N
88	Ground Ginger	g	4.9100	\N	2026-03-19 09:57:56.178646	450.0000	\N	\N	9	\N	\N	1.0000	\N	spice	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-88.png	f	\N
207	Brakes Chilli Jam	kg	9.8700	\N	2026-03-23 17:10:17.021776	1.2500	Brakes	126918	1	\N	https://www.brake.co.uk/dry-store/condiments-pickles/chutney-relish-pickles/chutney-relish/brakes-chilli-jam/p/126918	\N	\N	sauce	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	Chilli Jam	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-207.png	f	\N
175	Fresh Coriander	kg	9.8400	\N	2026-03-19 09:57:56.427958	1.0000	\N	\N	1	\N	\N	1.0000	\N	herb	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-175.png	f	\N
181	White Cooking Wine (Sysco)	kg	36.7800	\N	2026-03-19 09:57:56.442899	10.0000	\N	A 25696	1	\N	\N	1.0000	\N	other	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-181.png	f	\N
130	Red Wine	g	5.3700	\N	2026-03-19 09:57:56.311056	750.0000	\N	\N	10	\N	\N	1.0000	\N	other	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	0.0000	weight	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-130.png	f	\N
161	Vanilla Extract	g	5.5400	\N	2026-03-19 09:57:56.39402	500.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	1.0000	weight	1.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-161.png	f	\N
199	Double Cream	kg	8.9900	\N	2026-03-19 09:57:56.492088	2.2700	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	0.00	\N	t	2.0000	weight	3.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-199.png	f	\N
198	Extra Matture Cheddar	kg	22.1800	\N	2026-03-19 09:57:56.490298	2.4400	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	10.0000	weight	15.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-198.png	f	\N
188	Pork, Sage & Onion Stuffing Balls	kg	29.4100	\N	2026-03-19 09:57:56.464013	2.8800	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	4.0000	weight	6.0000	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-188.png	f	\N
23	Chorizo	g	5.5500	\N	2026-03-19 09:57:55.952772	500.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	24.0000	weight	40.0000	t	\N	1815.00	437.00	38.30	14.30	1.90	1.80	21.80	3.30	Chorizo (Pork, Paprika, Garlic, Salt, Spices)	[]	0.90	raw	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-23.png	f	\N
43	Oregano	g	3.0600	\N	2026-03-19 09:57:56.032231	150.0000	\N	\N	\N	\N	\N	\N	\N	\N	f	daily	\N	\N	\N	\N	\N	10.00	\N	t	3.0000	weight	3.0000	t	\N	1087.00	265.00	4.30	1.60	26.00	4.10	9.00	0.06	Oregano	[]	42.50	processed	/replit-objstore-fc601732-0030-4773-b358-ca672cedee80/.private/qr-codes/ingredient-43.png	f	\N
\.


--
-- Data for Name: kanban_items; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.kanban_items (id, ingredient_id, supplier_id, status, pulled_at, pulled_by_user_id, order_day_target, notes, created_at, source_type, recipe_id, sub_recipe_id, qr_code_url) FROM stdin;
1	62	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
2	139	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
3	49	\N	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
4	204	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
5	26	10	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
6	58	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
7	209	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
8	46	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
9	20	\N	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
10	53	5	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
11	55	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
12	67	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
13	61	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
14	24	2	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
15	41	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
16	50	5	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
17	52	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
18	68	5	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
19	29	\N	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
20	129	5	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
21	93	5	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
22	99	5	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
23	107	10	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
24	108	10	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
25	109	5	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
26	122	5	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
27	133	5	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
28	134	17	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
29	135	17	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
30	136	5	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
31	138	5	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
32	54	\N	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
33	27	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
34	32	2	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
35	38	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
36	30	5	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
37	25	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
38	163	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
39	206	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
40	193	24	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
41	11	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
42	31	12	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
43	45	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
44	28	10	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
45	59	16	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
46	3	5	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
47	65	5	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
48	33	10	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
49	36	\N	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
50	141	5	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
51	63	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
52	57	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
53	64	2	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
54	69	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
55	51	\N	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
56	70	\N	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
57	149	23	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
58	150	23	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
59	170	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
60	162	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
61	164	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
62	110	\N	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
63	111	\N	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
64	161	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
65	40	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
66	34	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
67	7	2	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
68	39	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
69	37	10	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
70	17	5	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
71	172	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
72	66	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
73	60	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
74	81	17	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
75	92	19	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
76	103	18	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
77	123	17	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
78	74	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
79	121	17	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
80	145	10	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
81	71	\N	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
82	85	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
83	113	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
84	82	17	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
85	124	\N	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
86	114	22	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
87	76	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
88	125	\N	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
89	115	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
90	104	17	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
91	94	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
92	96	20	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
93	101	17	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
94	102	17	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
95	106	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
96	120	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
97	126	17	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
98	143	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
99	146	23	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
100	147	23	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
101	144	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
102	116	17	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
103	132	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
104	142	10	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
105	117	10	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
106	118	10	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
107	127	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
108	140	2	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
109	100	\N	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
110	98	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
111	83	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
112	87	5	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
113	95	17	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
114	79	17	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
115	86	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
116	73	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
117	75	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
118	131	5	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
119	84	18	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
120	112	\N	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
121	200	\N	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
122	148	5	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
123	159	22	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
124	166	17	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
125	177	17	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
126	203	16	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
127	152	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
128	155	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
129	157	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
130	158	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
131	183	17	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
132	202	17	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
133	174	22	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
134	153	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
135	151	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
136	154	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
137	156	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
138	160	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
139	195	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
140	167	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
141	171	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
142	165	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
143	169	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
144	176	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
145	190	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
146	192	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
147	168	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
148	48	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
149	90	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
150	137	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
151	173	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
152	186	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
153	179	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
154	184	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
155	185	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
156	187	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
157	198	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
158	178	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
159	201	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
160	88	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
161	207	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
162	205	17	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
163	42	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
164	23	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
165	97	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
166	128	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
167	208	\N	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
168	35	\N	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
169	119	5	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
170	175	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
171	89	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
172	91	17	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
173	196	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
174	105	2	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
175	182	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
176	188	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
177	197	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
178	180	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
179	181	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
180	194	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
181	130	10	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
182	189	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
183	199	1	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
184	44	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
185	43	9	active	\N	\N	\N	\N	2026-03-28 08:38:18.416019	ingredient	\N	\N	\N
186	21	\N	active	\N	\N	\N	\N	2026-03-28 11:10:27.577195	ingredient	\N	\N	\N
187	19	\N	active	\N	\N	\N	\N	2026-03-28 11:10:27.577195	ingredient	\N	\N	\N
188	47	\N	active	\N	\N	\N	\N	2026-03-28 11:10:27.577195	ingredient	\N	\N	\N
\.


--
-- Data for Name: oven_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.oven_events (id, plan_id, recipe_id, recipe_name, ingredient_id, ingredient_name, tray_index, oven_in_at, oven_out_at, user_id, user_name) FROM stdin;
3	14	3	BBQ Pulled Pork 	22	Pork	2	2026-03-31 14:08:07.99921	2026-03-31 14:08:08.558	2	Graeme Carter
1	14	3	BBQ Pulled Pork 	22	Pork	1	2026-03-31 14:07:57.941692	2026-03-31 14:08:14.511	2	Graeme Carter
2	14	3	BBQ Pulled Pork 	22	Pork	0	2026-03-31 14:07:58.675286	2026-03-31 14:08:17.951	2	Graeme Carter
\.


--
-- Data for Name: page_permissions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.page_permissions (page_key, min_role) FROM stdin;
/	viewer
/plans	viewer
/recipes	viewer
/sub-recipes	viewer
/ingredients	viewer
/suppliers	viewer
/stock	viewer
/sales	manager
/dispatches	viewer
\.


--
-- Data for Name: password_resets; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.password_resets (id, token, user_id, created_at, expires_at, used_at) FROM stdin;
1	AipET6Qh_wXWD0P79tOnaYmYMo0artG4	1	2026-03-23 09:24:38.649	2026-03-23 10:24:38.649	2026-03-23 09:24:49.839
2	9619fccbb2912668c499fd185d5239bf636b5b5d87c08a416a2fe7843a6d460f	2	2026-03-23 16:28:29.366738	2026-03-23 17:28:29.365	\N
\.


--
-- Data for Name: postcode_validations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.postcode_validations (id, shopify_order_id, postcode, service_code, available, reason, checked_at, dispatch_tag) FROM stdin;
\.


--
-- Data for Name: prep_completions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.prep_completions (id, plan_id, ingredient_id, recipe_id, tin_number, user_id, completed_at, sub_recipe_id) FROM stdin;
\.


--
-- Data for Name: production_plan_items; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.production_plan_items (id, plan_id, recipe_id, notes, status, order_position, batches_target, batches_complete, wonly_count, tin_size, max_batches_per_tin, sop_url, wrapping_complete, fridge_qty, freezer_qty, prep_fridge_qty, extra_packs_built, short_count) FROM stdin;
116	15	1	\N	pending	1	9	0	0	XXL	10		f	0	0	0	0	0
80	11	4	\N	in-progress	5	7	0	0	XXL	10		f	0	0	0	0	0
117	15	10	\N	pending	2	4	0	0	XXL	10		f	0	0	0	0	0
118	15	6	\N	pending	3	4	0	0	XL	7		f	0	0	0	0	0
53	9	8	\N	pending	10	5	0	0	XXL	5		f	0	0	0	0	0
45	9	10	\N	pending	2	3	0	0	XXL	10		f	0	0	0	0	0
119	15	5	\N	pending	4	5	0	0	XXL	6		f	0	0	0	0	0
3	3	6	\N	in-progress	1	6	0	0	XL	7		t	30	0	0	0	0
120	15	4	\N	pending	5	7	0	0	XXL	10		f	0	0	0	0	0
121	15	2	\N	pending	6	8	0	0	XXL	10		f	0	0	0	0	0
25	7	3	\N	in-progress	2	9	0	5	XL	15		t	40	0	0	0	0
6	3	2	\N	in-progress	4	19	0	2	\N	10	\N	t	0	0	0	0	0
29	7	10	\N	pending	6	3	0	0	XXL	10		f	0	0	0	0	0
32	7	8	\N	pending	9	4	0	0	XXL	5		f	0	0	0	0	0
33	7	4	\N	pending	10	6	0	0	XXL	10		f	0	0	0	0	0
122	15	3	\N	pending	7	23	0	0	XL	15		f	0	0	0	0	0
123	15	9	\N	pending	8	4	0	0	XXL	10		f	0	0	0	0	0
124	15	7	\N	pending	9	5	0	0	XXL	12		f	0	0	0	0	0
81	11	2	\N	in-progress	6	8	0	0	XXL	10		f	0	0	0	0	0
26	7	5	\N	in-progress	3	3	0	0	XXL	6		f	0	0	0	0	0
24	7	6	\N	in-progress	1	3	0	0	XL	7		t	15	0	0	0	0
125	15	8	\N	pending	10	6	0	0	XXL	5		f	0	0	0	0	0
107	14	10	\N	in-progress	2	2	0	0	XXL	10		f	0	0	0	0	1
82	11	3	\N	in-progress	7	11	0	0	XL	15		f	0	0	0	0	0
108	14	6	\N	in-progress	3	8	0	0	XL	7		f	0	0	0	0	0
76	11	1	\N	in-progress	1	8	0	1	XXL	10		f	0	0	0	0	0
77	11	10	\N	in-progress	2	6	0	1	XXL	10		f	0	0	0	0	0
27	7	2	\N	in-progress	4	9	0	3	XXL	10		t	32	0	0	0	0
78	11	6	\N	in-progress	3	3	0	0	XL	7		f	0	0	0	0	0
79	11	5	\N	in-progress	4	2	0	0	XXL	6		f	0	0	0	0	0
106	14	1	\N	in-progress	1	4	0	0	XXL	10		f	0	0	0	0	0
109	14	5	\N	pending	4	2	0	0	XXL	6		f	0	0	0	0	0
4	3	3	\N	in-progress	6	23	0	0	\N	15	\N	f	0	0	0	0	0
5	3	5	\N	in-progress	3	16	0	0	\N	6	\N	f	0	0	0	0	0
110	14	4	\N	pending	5	4	0	0	XXL	10		f	0	0	0	0	0
28	7	9	\N	in-progress	5	25	0	0	XXL	10		f	0	0	0	0	0
30	7	1	\N	pending	7	9	0	0	XXL	10		f	0	0	0	0	0
7	3	1	\N	in-progress	2	2	0	0	\N	10	\N	f	0	0	0	0	0
8	3	4	\N	in-progress	5	14	0	3	\N	10	\N	f	0	0	0	1	0
111	14	2	\N	pending	6	4	0	0	XXL	10		f	0	0	0	0	0
112	14	3	\N	pending	7	42	0	0	XL	15		f	0	0	0	0	0
113	14	9	\N	pending	8	3	0	0	XXL	10		f	0	0	0	0	0
31	7	7	\N	pending	8	4	0	0		\N		f	0	0	0	0	0
114	14	7	\N	pending	9	3	0	0	XXL	12		f	0	0	0	0	0
115	14	8	\N	pending	10	3	0	0	XXL	5		f	0	0	0	0	0
100	13	4	\N	pending	5	7	0	0	XXL	10		f	0	0	0	0	0
101	13	2	\N	pending	6	8	0	0	XXL	10		f	0	0	0	0	0
102	13	3	\N	pending	7	11	0	0	XL	15		f	0	0	0	0	0
104	13	7	\N	pending	9	7	0	0	XXL	12		f	0	0	0	0	0
105	13	8	\N	pending	10	7	0	0	XXL	5		f	0	0	0	0	0
85	11	8	\N	pending	10	7	0	0	XXL	5		f	0	0	0	0	0
103	13	9	\N	pending	8	6	0	0	XXL	10		f	0	0	0	0	0
96	13	1	\N	in-progress	1	8	0	0	XXL	10		t	38	2	0	0	0
97	13	10	\N	in-progress	2	6	0	1	XXL	10		f	24	0	0	0	0
46	9	6	\N	pending	3	4	0	0	XL	7		f	0	0	0	0	0
44	9	1	\N	pending	1	7	0	0	XXL	10		f	0	0	0	0	0
48	9	2	\N	pending	4	10	0	0	XXL	10		f	0	0	0	0	0
47	9	4	\N	pending	5	9	0	0	XXL	10		f	0	0	0	0	0
49	9	5	\N	pending	6	4	0	0	XXL	6		f	0	0	0	0	0
50	9	3	\N	pending	7	12	0	0	XL	15		f	0	0	0	0	0
51	9	9	\N	pending	8	17	0	0	XXL	10		f	0	0	0	0	0
52	9	7	\N	pending	9	4	0	0	XXL	12		f	0	0	0	0	0
98	13	6	\N	pending	3	3	0	2	XL	7		f	0	0	0	0	0
99	13	5	\N	pending	4	2	0	0	XXL	6		f	0	0	0	0	0
83	11	9	\N	in-progress	8	6	0	0	XXL	10		f	0	0	0	0	0
84	11	7	\N	in-progress	9	7	0	0	XXL	12		f	0	0	0	0	0
\.


--
-- Data for Name: production_plans; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.production_plans (id, plan_date, name, notes, status, created_at, batch_number) FROM stdin;
3	2026-03-24	Production Plan – Tuesday 24 Mar 2026	\N	active	2026-03-20 08:11:19.602483	26083
5	2026-03-20	Production Plan – Friday 20 Mar 2026	\N	active	2026-03-20 15:54:23.987676	\N
7	2026-03-25	Production Plan – Wednesday 25 Mar 2026	\N	active	2026-03-23 16:14:00.375178	26084
11	2026-03-30	Production Plan – Monday 30 Mar 2026	\N	draft	2026-03-26 15:27:21.229579	26089
13	2026-03-30	Production Plan – Monday 30 Mar 2026	\N	draft	2026-03-26 16:19:50.962228	26089
9	2026-03-26	Production Plan – Thursday 26 Mar 2026	\N	draft	2026-03-24 14:10:36.372649	26085
14	2026-03-31	Production Plan – Tuesday 31 Mar 2026	\N	active	2026-03-31 14:05:49.448072	26090
15	2026-04-01	Production Plan – Wednesday 1 Apr 2026	\N	active	2026-03-31 14:05:59.168335	26091
\.


--
-- Data for Name: purchase_order_lines; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.purchase_order_lines (id, purchase_order_id, ingredient_id, quantity_required, quantity_ordered, quantity_received, unit, unit_price, checked_off, notes, use_by_date) FROM stdin;
1	1	22	14.0000	14.0000	0.0000	kg	5.8500	t	\N	\N
2	1	56	8.0000	8.0000	0.0000	kg	9.9000	t	\N	\N
3	2	12	5.0000	5.0000	0.0000	kg	13.9500	t	\N	\N
4	2	13	3.0000	3.0000	0.0000	kg	3.0500	t	\N	\N
5	2	18	300.0000	300.0000	0.0000	g	1.7900	t	\N	\N
6	3	191	10.0000	10.0000	0.0000	kg	16.5900	t	\N	\N
7	4	45	28.6000	13.0000	0.0000	packs	7.3900	t	\N	\N
\.


--
-- Data for Name: purchase_orders; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.purchase_orders (id, supplier_id, plan_id, status, created_at, placed_at, expected_delivery_date, notes, placed_by_user_id) FROM stdin;
2	5	9	placed	2026-03-24 15:00:58.665547	2026-03-24 15:00:58.809	2026-03-25	\N	3
1	3	9	placed	2026-03-24 14:17:09.128662	2026-03-24 14:17:09.623	2026-03-25	\N	3
3	1	9	placed	2026-03-24 16:01:58.151644	2026-03-24 16:01:58.349	2026-03-25	\N	3
4	9	9	placed	2026-03-24 17:00:11.266098	2026-03-24 17:00:11.458	2026-03-26	\N	3
\.


--
-- Data for Name: recipe_ingredients; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.recipe_ingredients (id, recipe_id, ingredient_id, quantity, marinade_for_ingredient_id, include_in_filling_mix, quid, is_topping, assembly_order) FROM stdin;
534	7	47	0.0750	\N	f	f	f	\N
535	7	193	0.0500	\N	t	f	f	\N
536	7	57	0.0200	\N	t	f	f	\N
537	7	139	0.0060	\N	f	f	f	\N
549	8	49	0.0370	\N	t	f	f	\N
550	8	24	0.0600	\N	t	f	f	\N
551	8	15	0.0200	\N	t	f	f	\N
552	8	7	0.0700	\N	t	f	f	\N
553	8	27	0.0070	\N	t	f	f	\N
495	2	47	0.0750	\N	f	f	f	\N
496	2	13	0.0140	\N	t	f	f	\N
497	2	23	15.0000	\N	t	f	f	\N
498	2	34	10.0000	\N	t	f	f	\N
499	2	31	0.0020	\N	f	f	f	\N
500	2	191	0.0600	\N	t	f	f	\N
501	2	12	0.0120	\N	t	f	f	\N
502	2	18	0.9000	\N	f	f	f	\N
514	4	47	0.0570	\N	f	f	f	\N
515	4	56	0.0570	\N	t	f	f	\N
516	4	57	0.0190	\N	t	f	f	\N
517	4	58	0.0240	\N	f	f	f	\N
518	4	59	0.0110	\N	f	f	f	\N
363	6	28	12.0000	\N	t	f	f	\N
364	6	16	0.0220	\N	t	f	f	\N
365	6	14	0.0220	\N	t	f	f	\N
366	6	12	0.0220	\N	t	f	f	\N
367	6	13	0.0200	\N	t	f	f	\N
368	6	47	0.0750	\N	f	f	f	\N
585	9	7	0.0760	\N	t	f	f	\N
586	9	23	38.0000	\N	t	f	f	\N
587	9	72	0.0070	\N	t	f	f	\N
595	10	47	0.0470	\N	t	f	f	\N
596	10	77	0.0470	\N	t	f	f	\N
597	11	210	0.0850	\N	f	f	f	\N
598	11	47	0.0230	\N	t	f	f	\N
599	11	208	0.0300	\N	f	f	f	\N
600	11	207	0.0180	\N	f	f	f	\N
601	11	206	0.0150	\N	f	f	f	\N
602	11	209	0.0520	\N	f	f	f	\N
603	11	59	0.0150	\N	f	f	f	\N
604	5	7	0.0750	\N	t	f	f	\N
605	5	191	0.0380	\N	t	f	f	\N
607	5	204	0.0370	\N	t	f	f	\N
608	5	11	0.0240	\N	f	f	f	\N
609	5	97	12.0000	\N	f	f	f	\N
606	5	205	0.0020	191	f	f	f	\N
614	1	7	0.0870	\N	t	f	f	\N
631	3	22	0.0825	\N	t	f	f	\N
632	3	47	0.0750	\N	f	f	f	\N
633	3	45	0.0450	\N	t	f	f	\N
634	3	19	0.0010	\N	f	f	f	\N
635	3	45	0.0060	22	f	f	f	\N
615	1	18	0.9024	\N	f	f	f	0
\.


--
-- Data for Name: recipe_meat_marinades; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.recipe_meat_marinades (id, recipe_id, raw_meat_ingredient_id, marinade_ingredient_id, marinade_sub_recipe_id, grams_per_kg) FROM stdin;
\.


--
-- Data for Name: recipe_shopify_mappings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.recipe_shopify_mappings (id, recipe_id, shopify_variant_id, shopify_product_title, shopify_variant_title, created_at, wonky_variant_id, wonky_product_title, wonky_variant_title) FROM stdin;
\.


--
-- Data for Name: recipe_sub_recipes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.recipe_sub_recipes (id, recipe_id, sub_recipe_id, quantity, marinade_for_ingredient_id, include_in_filling_mix, quid, is_topping, assembly_order) FROM stdin;
201	4	1	0.1150	\N	f	f	f	\N
202	4	2	0.0360	\N	t	f	f	\N
209	7	1	0.1150	\N	f	f	f	\N
210	7	2	0.0360	\N	t	f	f	\N
141	6	1	0.1150	\N	f	f	f	\N
142	6	2	0.0300	\N	t	f	f	\N
219	8	1	0.1150	\N	f	f	f	\N
230	9	1	0.1150	\N	f	f	f	\N
231	9	2	0.0380	\N	t	f	f	\N
234	10	1	0.1150	\N	f	f	f	\N
235	10	44	0.0190	\N	t	f	f	\N
236	10	43	0.0073	\N	f	f	f	\N
237	11	2	0.0180	\N	f	f	f	\N
238	11	1	0.1150	\N	f	f	f	\N
239	5	1	0.1150	\N	f	f	f	\N
241	5	2	0.0360	\N	t	f	f	\N
240	5	45	0.0030	204	f	f	f	\N
246	1	1	0.1150	\N	f	f	f	\N
247	1	2	0.0430	\N	t	f	f	\N
254	3	1	0.1150	\N	f	f	f	\N
195	2	1	0.1150	\N	f	f	f	\N
196	2	2	0.0360	\N	t	f	f	\N
255	3	42	0.0010	22	t	f	f	\N
\.


--
-- Data for Name: recipes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.recipes (id, name, description, servings, serving_unit, category, notes, created_at, pack_size, rrp, packaging_cost, labour_cost, portions_per_batch, shelf_life_days, tin_size, max_batches_per_tin, sop_url, fill_weight_grams, base_type, base_weight_grams, is_core_menu, color, is_current_special, cooking_loss_percent) FROM stdin;
11	The Don Burger		1.0000	portion	Calzones		2026-03-23 17:04:29.246596	2.0000	17.9500	0.4000	3.0000	10	10	M	10		\N	\N	\N	f	#000000	f	3.00
5	Carnizone	Ground spicy beef, seasoned chicken, pepperoni, creamy fior di latte and a drizzle of honey. Sweet, mildly spicy and irresistibly meat-heavy.	1.0000	portion	Calzones		2026-03-19 16:16:05.821934	2.0000	16.9500	0.4000	3.0000	10	13	XXL	6		\N	\N	\N	f	#b30000	f	3.00
7	New Yorker	Traditionally prepared pastrami with sliced gherkins American mustard and mozzarella on our signature tomato base	1.0000	portion	Calzones		2026-03-20 20:17:18.083149	2.0000	13.9500	0.4000	3.0000	10	0	XXL	12		\N	\N	\N	f	#ebb800	f	3.00
1	Margherita	Neapolitan-inspired 24-hour dough on our signature tomato base, fresh basil and beautifully creamy Fior di Latte mozzarella.	1.0000	portion	Calzones		2026-03-18 09:39:37.664286	2.0000	10.7000	0.4000	2.5000	10	13	XXL	10		\N	\N	\N	f	#d19900	f	3.00
6	Balsamic Roasted Vegetables	Balsamic roasted mushrooms, peppers, red onions and courgette all topped with mozzarella on our signature tomato base.	1.0000	portion	Calzones		2026-03-20 08:01:28.013968	2.0000	10.9500	0.4000	3.0000	10	13	XL	7		\N	\N	\N	t	#6600ff	f	3.00
8	The Donald	Gressingham Peking shredded duck with a rich and sweet Hoisin sauce, spring onions, and creamy Fior Di Latte mozzarella.	1.0000	portion	Calzones		2026-03-21 14:44:15.111669	2.0000	14.7500	0.4000	3.0000	10	13	XXL	5		\N	\N	\N	f	#ff00a2	f	3.00
3	BBQ Pulled Pork 	Slow roasted BBQ pulled pork, rosemary and mozzarella on a sweet and smokey BBQ base.	1.0000	portion	Calzones		2026-03-19 15:30:46.055423	2.0000	12.6500	0.4000	3.0000	10	13	XL	15		\N	\N	\N	t	#ff00ea	f	3.00
2	Chicken and Chorizo	Piri piri chicken, sliced chorizo, feta, red pepper, red onion, fresh basil and mozzarella on our spicy tomato base.	1.0000	portion	Calzones		2026-03-19 12:42:04.415962	2.0000	13.1500	0.4000	3.0000	10	13	XXL	10		\N	\N	\N	f	#ff7300	f	3.00
4	The Godfather	Locally sourced brisket, chuck and short rib 100% beef burger patty, ‘Sauce Shop’ burger sauce, gherkins, caramelised red onion chutney and mozzarella on our signature tomato base.	1.0000	portion	Calzones		2026-03-19 15:54:43.832711	2.0000	13.9000	0.4000	3.0000	10	13	XXL	10		\N	\N	\N	f	#0d0d0d	f	3.00
9	Chorizo Chilli & Fior Di Latte	A double portion of shredded chorizo with fresh sliced red chillies and creamy fior di latte mozzarella on our signature spicy base (medium spice level).	1.0000	portion	Calzones		2026-03-21 15:11:31.052665	2.0000	12.6500	0.4000	3.0000	10	0	XXL	10		\N	\N	\N	f	#ff0000	f	3.00
10	Garlic Cheese Calzones (V)	Roasted garlic herb confit with mozzarella and mature cheddar in our 24-hour Neapolitan-inspired dough, topped with our own garlic and parsley butter.	1.0000	portion	Calzones	Roasted garlic herb confit with mozzarella and mature cheddar in our 24-hour Neapolitan-inspired dough, topped with our own garlic and parsley butter.	2026-03-21 15:13:29.715818	2.0000	10.4500	0.4000	3.0000	10	0	XXL	10		\N	\N	\N	t	#219712	f	3.00
\.


--
-- Data for Name: sales_entries; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sales_entries (id, recipe_id, sale_date, quantity_sold, channel, notes, created_at) FROM stdin;
\.


--
-- Data for Name: sessions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sessions (sid, sess, expire) FROM stdin;
-2TsYoLbH8L9V6F-iMlr3-T0mXN5W9wf	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-06T07:02:35.586Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-30T07:02:35.680Z"}	2026-04-06 08:57:21
goBDGOKp8MSSRLc1z4HuWxnL0pd2xRxk	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-03T16:21:57.440Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-27T16:21:57.542Z"}	2026-04-03 17:19:50
yDsfHbFNzvW7moqrNbR_TUnaDTJAFsVs	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-06T19:25:05.788Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-30T19:25:12.858Z"}	2026-04-06 19:25:31
Nt6FA5B34svDTIdwtHw-YopaOx9pKGhF	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-03T09:28:17.634Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-27T09:28:17.727Z"}	2026-04-03 09:29:56
c7UbwxJvt0M-0nS21qaDGP4phJecW48R	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-03T10:09:07.458Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-27T10:09:07.562Z"}	2026-04-03 10:09:17
DJ_J5-xu9mB1Z3bf0oY7kS1_yj2x5fO5	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-02T08:10:06.993Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-26T08:10:07.086Z"}	2026-04-02 08:10:40
lvpqHuepIUmS7MNzJaYaW_UGJj4KLjP8	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-02T09:45:45.023Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-26T09:45:45.115Z"}	2026-04-02 09:46:21
bD5jjYIdxWtR8OWc-kYXRz8wt7ttbP4o	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-02T17:47:08.221Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-26T17:47:08.324Z"}	2026-04-02 17:48:24
wd7VNcBsw-1AD_Bb_13ka-MvSDcsCSBd	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-03T08:51:35.128Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-27T08:51:35.238Z"}	2026-04-03 08:51:36
GzmMRVELTcpW99Qaw-Qa5OsgSKfT8r9V	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-02T17:53:14.758Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-26T17:53:14.850Z"}	2026-04-02 17:53:16
SeAgpWcUEwITCdi2B0lRG_C4cVsi19Ms	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-03T08:51:39.805Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-27T08:51:39.889Z"}	2026-04-03 08:51:40
IsCGr8jL1RN1l-lvFiJeXrrpH9WUrqfq	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-03T17:35:03.954Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-27T17:35:04.034Z"}	2026-04-03 17:35:09
VC1Rd-NYxNxS3NcxMPKpt92GWIxK6xsy	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-02T18:26:00.178Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-26T18:26:00.276Z"}	2026-04-02 18:26:01
p9pjzGo3pWa6O8k9XRYbRFyj94N_d11-	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-02T18:26:08.328Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-26T18:26:08.412Z"}	2026-04-02 18:26:09
nJSlmfLzaIQM_ORsSrxTuPjvW3NcHrwO	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-03T10:10:50.716Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-27T10:10:50.827Z"}	2026-04-03 10:11:04
1VGtEyn0p0Fk9wO376ErxJtVjkp1k00t	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-03T08:51:44.191Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-27T08:51:44.272Z"}	2026-04-03 08:51:45
wmpTIUOZPdFF7zWh51fTTzmDSgRrbyRX	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-03T08:51:49.194Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-27T08:51:49.280Z"}	2026-04-03 08:51:50
zOUElJ8-uoYQx3GpYX5ZzemObhy2A2LJ	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-03T08:51:57.628Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-27T08:51:57.711Z"}	2026-04-03 08:51:58
Xk9p8vRJaey4d6l2ARe2jBt70lBpR33p	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-03T07:19:15.248Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-27T07:19:15.348Z"}	2026-04-03 07:21:56
uocGb5kc5IlJGgjXPZWNPLW9aRimDEdK	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-02T18:30:35.560Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-26T18:30:35.683Z"}	2026-04-02 18:31:17
KgpjoUbDNYU8vTNnbpr2f4sbPVmAQvmN	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-03T07:34:02.213Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-27T07:34:02.311Z"}	2026-04-03 07:34:20
NKwNBB1UdqDSwOvu1IZcrJAHB2GTcPlI	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-02T19:18:24.744Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-26T19:18:24.841Z"}	2026-04-02 19:18:58
cNHF8EOwp8NMBZk-QzAytTpxCd5hNbvp	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-03T09:03:01.384Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-27T09:03:01.479Z"}	2026-04-03 09:06:32
X8Pyl5ENgHuoPf6TgkjIileJ6FO5inZ3	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-03T10:41:52.363Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-27T10:41:52.453Z"}	2026-04-03 11:59:22
DFni6tbZkVYaIzC4mFe2PI2sim8zKkB3	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-03T09:26:01.494Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-27T09:26:01.585Z"}	2026-04-03 09:27:42
xoTGMvVZvNxg2L4SCHCvJj0D7zYRJkyZ	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-03T14:13:21.156Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-27T14:13:21.255Z"}	2026-04-03 15:39:37
puLraqzfyRj9CdhlugWZ-e5TuzrdDpth	{"cookie":{"originalMaxAge":2592000000,"expires":"2026-04-30T11:28:13.517Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-31T11:28:13.615Z"}	2026-04-30 11:29:04
5J0jRYTYMENwsZT55dLnvL3c1fq7l0Cm	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-07T07:24:06.843Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-31T07:24:06.950Z"}	2026-04-07 07:26:51
o2tMa5ZBhKs9uaWLjVUrWvPoYvHPagU2	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-03T16:59:51.315Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-27T16:59:51.419Z"}	2026-04-03 17:01:22
iLXmDnP4AMH479R_jN4SxHudYgcNj2DP	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-04T09:05:31.140Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-28T09:05:31.234Z"}	2026-04-04 09:05:32
nNNn-vO_leNm7g9w635WD8cJ5EuG96GB	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-03T20:41:35.013Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-27T20:41:35.105Z"}	2026-04-03 20:42:11
gtS6AOLYWftjwaE5DeB8bcXbrtpXwLsf	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-07T10:21:52.321Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-31T10:21:52.418Z"}	2026-04-07 10:22:08
wFt9_9FKfoGRZKakuzf9aAgNEBt2FSSK	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-06T08:57:24.331Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-30T08:57:24.419Z"}	2026-04-06 17:22:15
_LA-XwF2h0OwW9J8JhLDYrNHHRB-KceB	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-04T09:16:31.967Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-28T09:16:32.071Z"}	2026-04-04 09:17:52
osYIEXTzViHuNYZE4f5c8ZfiFIHh35Gf	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-03T08:58:56.619Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-27T08:58:56.725Z"}	2026-04-03 09:01:25
_V7YQth0N_aAdj5QyicR0WzICtcvqo6E	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-06T17:41:23.507Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-30T17:41:23.610Z"}	2026-04-06 17:42:19
NfL6LO8dzM6NkAugcwtphSNHXyPXCANy	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-07T10:35:00.760Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-31T10:35:00.858Z"}	2026-04-07 10:35:08
eRGDBx3UjBwDu6Osn7jnd5CcpoGLKvZC	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-03T12:00:17.645Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-27T12:00:17.744Z"}	2026-04-03 12:00:37
aOIBXuAeNNORuANTcAg1qdY_Q0SJxcR4	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-06T19:35:41.638Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-30T19:35:41.739Z"}	2026-04-06 19:36:25
BJ7myNagMKFM5sIBI5Ik-lItpCXbyyB8	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-06T18:04:20.466Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-30T18:04:20.570Z"}	2026-04-06 18:04:30
-ARPp3si1SV_8wBbA1gTCQUg957NxEob	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-03T07:33:04.283Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-27T07:33:04.416Z"}	2026-04-03 07:33:05
57yxCjocevrW67bPvAAIa3uyCV6dFgvK	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-04T09:18:43.893Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-28T09:18:43.996Z"}	2026-04-04 09:19:52
VAiXr1dptHM4GOatgBWMj4KpdOIlrgyo	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-03T09:13:39.537Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-27T09:13:39.628Z"}	2026-04-03 09:14:50
6thz4cswdWWPf_vMMhXsXrkgMv8OV_jq	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-03T16:20:48.674Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-27T16:20:48.774Z"}	2026-04-03 16:20:55
5yDlpRO-aJIKs5qFV-vp99z9cdXepozr	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-04T08:45:53.204Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-28T08:45:53.304Z"}	2026-04-04 08:47:00
PY8D5uoKlf0_2-25JbU9AEzuAiiXSCZ_	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-04T08:49:33.820Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-28T08:49:33.908Z"}	2026-04-04 08:50:27
DXkpStYROkKIPPMVP_Dkp1XG9wpvugyN	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-03T17:35:48.170Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-27T17:35:48.260Z"}	2026-04-03 17:36:00
mrOR_bbkdtS7lQ7o5IIPGA3vgADj3LbQ	{"cookie":{"originalMaxAge":2592000000,"expires":"2026-04-30T15:23:46.661Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-31T15:23:46.752Z"}	2026-04-30 15:23:53
Da231mTPJzttmoHxdgf5pjQyr5MHduIf	{"cookie":{"originalMaxAge":2592000000,"expires":"2026-04-30T10:44:09.405Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-31T10:44:09.494Z"}	2026-04-30 10:44:29
ab8HcQu01bo8eFzYMwoH1BCtmLwB_SlX	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-03T20:45:24.879Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-27T20:45:24.978Z"}	2026-04-03 20:46:09
lNL1xWJKa0exKzwpeBN2RKkKQWllImKz	{"cookie":{"originalMaxAge":2592000000,"expires":"2026-04-30T10:55:27.797Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-31T10:55:27.886Z"}	2026-04-30 10:55:35
saH-N9B2nI_7gaYoaOSvxOQEhdAwI0ux	{"cookie":{"originalMaxAge":2592000000,"expires":"2026-04-30T11:07:37.541Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-31T11:07:37.632Z"}	2026-04-30 11:09:12
tEpk32ipU7JjM0REs9ccTXe2oMDHBcuB	{"cookie":{"originalMaxAge":2592000000,"expires":"2026-04-30T15:38:48.324Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-31T15:38:48.416Z"}	2026-04-30 15:38:55
X2k7_QJEWZFUl0Ndm_zjlyw1M9Fyo5s1	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-07T10:27:25.415Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-31T10:27:25.503Z"}	2026-04-07 10:34:14
bVm07Y-RuWn9DdSXuhWMcGWz4moVEq1_	{"cookie":{"originalMaxAge":2592000000,"expires":"2026-04-30T11:16:42.694Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-31T11:16:42.797Z"}	2026-04-30 11:18:13
_5CgQcJ42Ds362RwWBbNTrPjTjh2kzSk	{"cookie":{"originalMaxAge":2592000000,"expires":"2026-04-30T15:39:24.502Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-31T15:39:24.594Z"}	2026-04-30 15:39:56
ZOQ91LwOEXkVkDlfjunUVe9RPA_dMi7T	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-06T19:26:08.255Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-30T19:26:08.353Z"}	2026-04-06 19:27:43
8J0BQb094arBw8awPQojL7vivHEkVCzO	{"cookie":{"originalMaxAge":2592000000,"expires":"2026-04-30T10:43:40.505Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-31T10:43:40.601Z"}	2026-04-30 10:53:33
-cNGOlU8sOyNsLcsL0cOKlGBv_LHH4xW	{"cookie":{"originalMaxAge":2592000000,"expires":"2026-04-30T10:49:24.545Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-31T10:49:24.655Z"}	2026-04-30 10:49:33
H_XgW2LSOWMkgQHEf_53e0hruqbmHGuN	{"cookie":{"originalMaxAge":2592000000,"expires":"2026-04-30T15:50:03.997Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-31T15:50:04.100Z"}	2026-04-30 15:50:20
rFcucZx7CEAZrqi9cSw-2e4aWixBUtUf	{"cookie":{"originalMaxAge":2592000000,"expires":"2026-04-30T15:24:35.889Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-31T15:24:35.987Z"}	2026-04-30 15:25:00
SuUkA41XN426EnLtFx5JS0XSH8IoRU3Z	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-04T08:57:28.943Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-28T08:57:29.041Z"}	2026-04-04 08:58:11
rg-l4t5cGtrQ4qI4EzjXvWF44n9SniN7	{"cookie":{"originalMaxAge":2592000000,"expires":"2026-04-30T15:30:47.123Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-31T15:30:47.215Z"}	2026-04-30 15:33:43
cLIL4RduunWsz2WcOi-YN2nx6UrUCyb2	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-06T19:21:43.006Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-30T19:21:43.097Z"}	2026-04-06 19:23:11
_Z9m3DEvuMCw4wbT71iTDAkm7Ey064M7	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-03T17:12:50.175Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-27T17:12:50.267Z"}	2026-04-03 17:16:38
OczdKb-mjmuYLR-FRuDy3EsHS5UOLO98	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-06T18:13:25.791Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-30T18:13:25.892Z"}	2026-04-06 18:13:42
2hJTUkEu6PCajii_NpdaiuI5DLtXlvOV	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-04T09:06:03.338Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-28T09:06:03.423Z"}	2026-04-04 09:06:05
yPCV29N2WVM3vw3rAMDsKjVoZc2X9OoX	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-04T08:48:08.533Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-28T09:12:32.120Z"}	2026-04-04 11:09:20
QcwBcxXt6PP3oXK3xOG_jkPzwTnC-1wW	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-04T09:05:06.835Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-28T09:05:06.934Z"}	2026-04-04 09:05:07
LCvZTiAzQkp4ydi5J8LpLrAG8A_1tV5s	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-06T18:15:05.907Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-30T18:15:06.046Z"}	2026-04-06 18:16:10
9BfK6zmQd0RgiO_7GkTlpxNUTWSkId4e	{"cookie":{"originalMaxAge":2592000000,"expires":"2026-04-30T11:27:10.959Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-31T11:27:11.058Z"}	2026-04-30 11:27:32
hTc_IJW83XIWgilNwginc3EB_Cy-c_x3	{"cookie":{"originalMaxAge":2592000000,"expires":"2026-04-30T15:41:02.431Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-31T15:41:02.523Z"}	2026-04-30 15:42:16
jyZDoqpw0iswsVyPQGQOS1CjX1kFndKg	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-01T09:35:28.237Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":2,"userRole":"admin","pinVerifiedAt":"2026-03-31T07:12:46.577Z"}	2026-04-08 07:43:34
6xSH2eAkJKUXmzvIxoaEo2bYzU9wESaF	{"cookie":{"originalMaxAge":2592000000,"expires":"2026-04-30T15:29:47.286Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-31T15:29:47.376Z"}	2026-04-30 15:30:12
Hmks4oIJgpcax-pjB5H4mbabAysYkUGz	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-01T11:34:59.844Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin"}	2026-04-01 11:35:00
-EixAMxcWIJ57msZkaZQLXj1lIjq9lbL	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-01T09:33:13.627Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin"}	2026-04-01 09:33:52
GBhT0q9efgdw_gIU6ktbuuDBIV5CMeJX	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-03T10:12:54.147Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-27T10:12:54.247Z"}	2026-04-03 10:13:56
EKGldojpzqVWGAE2EuKz2iBiSrBIieIc	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-01T11:35:04.537Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin"}	2026-04-01 11:35:26
3t9tPPB9y5M_IEOnnW9R_RtGiQ32TqR7	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-02T17:51:50.725Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-26T17:51:50.824Z"}	2026-04-02 17:51:51
ZvyZ3R-4SWMx1uSqPj-8__NhSOvGE9V1	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-02T17:52:04.351Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-26T17:52:04.432Z"}	2026-04-02 17:52:05
dnQ1kIlXh6vKvNqFoHvn-YImSg5EwxWJ	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-02T17:51:57.465Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-26T17:51:57.547Z"}	2026-04-02 17:51:58
4eDqQqRDS0si1amaXiQGN8MmA2m0I5iZ	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-01T17:02:07.732Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin"}	2026-04-01 17:02:52
6eykl0sNGILJTpJqmj-ixx-HkN3EMweH	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-02T17:54:07.583Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-26T17:54:07.689Z"}	2026-04-02 17:55:21
EDIRLSlyCQB2FbbshcPXkxUXtLtMTeDd	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-02T18:24:38.467Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-26T18:24:38.562Z"}	2026-04-02 18:24:39
FBaQqdUHjxoldOC7wCy4JeEqZuY62R36	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-02T18:27:40.362Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-26T18:27:40.459Z"}	2026-04-02 18:27:41
C3csoqKYUDNfk5dx2Ub55bFE5brhQP20	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-02T08:02:54.367Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-26T08:02:54.476Z"}	2026-04-02 08:03:05
hy6cbowtoH1YAo15LnDQYyMIiNJmGyvp	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-02T19:16:41.525Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-26T19:16:41.623Z"}	2026-04-02 19:17:15
weP7sQKmIvtAs7WlHpMQnHK2kcfmg9c2	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-02T09:57:11.447Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-26T09:57:11.564Z"}	2026-04-02 09:58:08
mObPLtfPcRNRdoQ5iTgp2UB7mX4IQi5x	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-02T09:59:01.571Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-26T09:59:01.669Z"}	2026-04-02 09:59:52
1miNpvPWzU_mhpMwg0jMtX2MNbkJ3oqz	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-02T08:12:36.739Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-26T08:12:36.830Z"}	2026-04-02 08:12:38
JepBYzVfiRhn7GXXEnCtC_x1orDdftRY	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-01T11:42:49.884Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin"}	2026-04-01 11:48:33
Qbdgyy4-b1V6NFPvHMVMJqc1pt5MDxYq	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-02T06:03:39.958Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin"}	2026-04-02 06:04:05
t-eE6dcAIOfiIZGJ4MVAEV2bT1V_m4eW	{"cookie":{"originalMaxAge":604800000,"expires":"2026-04-02T08:00:16.822Z","secure":false,"httpOnly":true,"path":"/","sameSite":"lax"},"userId":3,"userRole":"admin","pinVerifiedAt":"2026-03-26T08:00:16.911Z"}	2026-04-02 08:00:36
\.


--
-- Data for Name: sku_locations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sku_locations (sku, zone, location_label, updated_at) FROM stdin;
\.


--
-- Data for Name: station_breaks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.station_breaks (id, plan_id, station_type, user_id, break_type, started_at, ended_at) FROM stdin;
1	3	wrapping	1	morning	2026-03-20 09:56:48.7	2026-03-20 09:56:53.925
2	3	wrapping	1	lunch	2026-03-20 09:56:55.141	2026-03-20 09:56:56.424
9	3	packing	1	morning	2026-03-22 06:26:27.658	2026-03-22 06:26:30.679
3	3	ovens	1	morning	2026-03-20 12:56:16.65	2026-03-22 20:02:51.028
10	3	ovens	1	morning	2026-03-23 15:57:35.306	2026-03-23 15:57:41.707
11	3	ovens	1	lunch	2026-03-23 15:57:48.062	2026-03-23 15:57:53.528
12	3	ovens	1	morning	2026-03-23 15:57:57.24	2026-03-23 15:57:59.461
13	13	mixing	2	morning	2026-03-30 17:56:44.753	2026-03-30 17:56:45.949
14	13	building_1	2	morning	2026-03-30 17:56:44.753	2026-03-30 17:56:45.949
15	13	building_2	2	morning	2026-03-30 17:56:44.753	2026-03-30 17:56:45.949
16	13	ovens	2	morning	2026-03-30 17:56:44.753	2026-03-30 17:56:45.949
17	13	wrapping	2	morning	2026-03-30 17:56:44.753	2026-03-30 17:56:45.949
18	13	prep_veg	2	morning	2026-03-30 17:56:44.753	2026-03-30 17:56:45.949
19	13	prep_bases	2	morning	2026-03-30 17:56:44.753	2026-03-30 17:56:45.949
20	13	prep_meat	2	morning	2026-03-30 17:56:44.753	2026-03-30 17:56:45.949
\.


--
-- Data for Name: stock_entries; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.stock_entries (id, recipe_id, ingredient_id, item_type, quantity, unit, checked_at, notes, location, stock_item_id, use_by_date) FROM stdin;
2	6	\N	recipe	0.0000	packs	2026-03-22 10:25:44.753903	Calculator override	production_fridge	\N	\N
16	3	\N	recipe	0.0000	2 Pack	2026-03-23 15:27:11.349242		production_fridge	\N	\N
18	\N	\N	ingredient	-3.0000	kg	2026-03-24 09:47:22.646058	Transfer out to prep_fridge	production_fridge	\N	\N
20	\N	\N	ingredient	0.0000	kg	2026-03-24 11:00:18.677748	\N	production_fridge	\N	\N
1	6	\N	recipe	37.0000	2 Packs	2026-03-22 09:32:38.395986	Calculator override	production_fridge	\N	\N
4	3	\N	recipe	103.0000	2 Packs	2026-03-22 11:01:11.237075		production_fridge	\N	\N
5	5	\N	recipe	51.0000	2 Packs	2026-03-22 11:01:29.003676		production_fridge	\N	\N
12	4	\N	recipe	59.0000	2 Packs	2026-03-22 11:03:08.37112		production_fridge	\N	\N
6	2	\N	recipe	78.0000	2 Packs	2026-03-25 12:17:36.462		production_fridge	\N	\N
7	9	\N	recipe	40.0000	2 Packs	2026-03-22 11:01:46.144998		production_fridge	\N	\N
11	8	\N	recipe	63.0000	2 Packs	2026-03-22 11:02:59.531346		production_fridge	\N	\N
10	7	\N	recipe	59.0000	2 Packs	2026-03-22 11:02:38.209614		production_fridge	\N	\N
9	1	\N	recipe	68.0000	2 Packs	2026-03-30 17:55:37.818		production_fridge	\N	\N
23	1	\N	recipe	2.0000	packs	2026-03-30 17:55:37.935254	Auto-created from wrapping station (wonky packs)	production_freezer	\N	\N
8	10	\N	recipe	94.0000	2 Packs	2026-03-30 17:55:40.95		production_fridge	\N	\N
\.


--
-- Data for Name: stock_item_categories; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.stock_item_categories (id, name, created_at) FROM stdin;
1	Packaging	2026-03-24 09:57:13.402422
2	Cleaning Materials	2026-03-24 09:57:13.402422
3	Chemicals	2026-03-24 09:57:13.402422
\.


--
-- Data for Name: stock_items; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.stock_items (id, name, category, unit, pack_weight, cost_per_pack, supplier_id, secondary_supplier_id, supplier_part_number, ordering_url, stock_check_enabled, stock_check_frequency, stock_check_day, notes, created_at) FROM stdin;
\.


--
-- Data for Name: stock_transfers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.stock_transfers (id, ingredient_id, from_location, to_location, quantity, unit, transferred_at, user_id, notes) FROM stdin;
1	\N	production_fridge	prep_fridge	5.0000	kg	2026-03-24 09:39:57.867775	3	test transfer
2	\N	production_fridge	prep_fridge	5.0000	kg	2026-03-24 09:40:01.826064	3	test transfer
3	\N	production_fridge	prep_fridge	2.0000	kg	2026-03-24 09:41:26.201926	3	\N
4	\N	production_fridge	prep_fridge	3.0000	kg	2026-03-24 09:47:22.641476	3	test transfer with stock entries
\.


--
-- Data for Name: storage_locations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.storage_locations (id, name, zone, is_system, created_at) FROM stdin;
1	Prep Fridge	fridge	t	2026-03-24 09:35:49.936374
2	Raw Meat Fridge	fridge	t	2026-03-24 09:35:49.939283
3	Raw Freezer	freezer	t	2026-03-24 09:35:49.941988
4	Production Fridge	fridge	t	2026-03-24 09:35:49.945138
5	Production Freezer	freezer	t	2026-03-24 09:35:49.947907
6	Dry Store	ambient	t	2026-03-24 09:35:49.950315
\.


--
-- Data for Name: storage_racks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.storage_racks (id, location_id, label) FROM stdin;
\.


--
-- Data for Name: sub_recipe_ingredients; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sub_recipe_ingredients (id, sub_recipe_id, ingredient_id, quantity) FROM stdin;
78	41	27	1.4430
79	41	3	0.3000
80	41	41	591.0000
81	41	38	545.0000
82	41	39	148.0000
83	42	3	1.0000
84	42	27	1.0000
85	42	128	1000.0000
96	43	65	0.2500
97	43	86	20.0000
98	43	25	0.0010
99	43	66	1.0000
100	44	63	3.0000
101	44	3	0.0160
102	44	38	31.0000
103	44	19	6.0000
104	44	62	6.0000
105	44	25	0.7500
106	45	128	534.0000
107	45	73	356.0000
108	45	38	356.0000
109	45	87	0.2370
110	45	43	178.0000
111	45	40	178.0000
112	45	42	71.0000
113	45	3	0.0890
114	46	41	1313.0000
115	46	3	1.3130
116	46	40	375.0000
117	1	3	0.4500
118	1	25	0.6300
119	1	32	20.0000
120	1	33	15.0000
121	1	95	11.6650
122	47	79	0.1000
123	2	26	5.0000
124	2	95	2.1820
125	2	37	4000.0000
\.


--
-- Data for Name: sub_recipe_sub_recipes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sub_recipe_sub_recipes (id, sub_recipe_id, component_sub_recipe_id, quantity) FROM stdin;
37	2	41	0.6560
\.


--
-- Data for Name: sub_recipes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sub_recipes (id, name, description, yield, yield_unit, notes, created_at, shelf_life_days, is_base, label_declaration) FROM stdin;
41	Normal Base Dry Mix	Dry spice mix for TCK Signature normal base	3.0270	kg		2026-03-19 11:27:06.116351	\N	f	\N
42	Pork Rub		1.0000	kg		2026-03-19 14:50:42.689954	\N	f	\N
43	Garlic Butter	\N	0.2710	kg	\N	2026-03-19 15:58:57.192978	\N	f	\N
44	Garlic Confit	\N	3.8090	kg	\N	2026-03-19 16:00:48.266261	\N	f	\N
45	Beef Seasoning	\N	2.0000	kg	\N	2026-03-19 16:14:31.470141	\N	f	\N
46	Chicken Seasoning 	Carnizone Chicken Seasoning	2.6260	kg		2026-03-21 10:27:14.122765	90	f	\N
1	Calzone Dough		32.7600	kg	20kg Flour Mix	2026-03-17 17:30:37.829435	3	f	\N
47	Test Spice Rub XQ7		0.5000	kg		2026-03-25 04:43:42.804587	1	f	\N
2	Tomato Base	TCK Signature Tomato Base	11.8380	kg	Needs base mix adding as sub recipe	2026-03-18 09:38:47.72806	0	t	\N
\.


--
-- Data for Name: suppliers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.suppliers (id, name, contact_name, email, phone, website, address, notes, created_at, order_frequency, order_days, lead_time_days, cutoff_time) FROM stdin;
1	Brakes Food Service	Katherine Tierney	Katherine.Tierney@sysco.com	01827 303770	https://www.brake.co.uk/en-GB	\N	\N	2026-03-18 06:02:49.051958	daily	\N	1	17:00
2	Express Food Service	\N	\N	\N	https://www.express-foodservice.co.uk/	\N	\N	2026-03-19 09:12:57.620793	daily	\N	1	17:00
3	The Best Butcher	Simon Boddy	bestbutchers@gmail.com	 01908 375 275	https://www.thebestbutchers.co.uk/	\N	\N	2026-03-19 09:13:52.553922	daily	\N	1	17:00
8	Basco Fine Foods	\N	\N	\N	\N	\N	\N	2026-03-19 09:57:55.9487	daily	\N	1	17:00
9	Waterdene	\N	\N	\N	\N	\N	\N	2026-03-19 09:57:55.959532	daily	\N	1	17:00
12	Butcher Sundries	\N	\N	\N	\N	\N	\N	2026-03-19 09:57:55.984561	daily	\N	1	17:00
16	The Sauce Shop	\N	\N	\N	\N	\N	\N	2026-03-19 09:57:56.083865	daily	\N	1	17:00
17	TCK	\N	\N	\N	\N	\N	\N	2026-03-19 09:57:56.149047	daily	\N	1	17:00
18	Dalziel	\N	\N	\N	\N	\N	\N	2026-03-19 09:57:56.165602	daily	\N	1	17:00
19	Universal Products	\N	\N	\N	\N	\N	\N	2026-03-19 09:57:56.191788	daily	\N	1	17:00
20	Starry Mart	\N	\N	\N	\N	\N	\N	2026-03-19 09:57:56.206356	daily	\N	1	17:00
22	Amazon	\N	\N	\N	\N	\N	\N	2026-03-19 09:57:56.262106	daily	\N	1	17:00
23	Bidfood	\N	\N	\N	\N	\N	\N	2026-03-19 09:57:56.337421	daily	\N	1	17:00
24	Jay D Meats	\N	\N	\N	\N	\N	\N	2026-03-19 09:57:56.475513	daily	\N	1	17:00
10	A D Maria	\N	\N	\N	\N	\N	\N	2026-03-19 09:57:55.966009	weekly	Tuesday	2	17:00
5	AB Fruits	\N	\N	\N	https://app.fresho.com/customer_ordering/companies/77747b4c-4862-4ae6-9ff9-3c26d7bb45b3/marketplaces	\N	\N	2026-03-19 09:57:55.892745	daily	\N	1	16:00
25	Test Lead Time Supplier	\N	\N	\N	\N	\N	\N	2026-03-24 14:30:57.710093	daily	\N	3	10:00
26	NFS Meats	Vera	sales@nfsmeats.co.uk	01604 761746	https://nfsmeats.co.uk/	\N	\N	2026-03-24 15:57:12.642249	daily	\N	2	17:00
\.


--
-- Data for Name: temperature_records; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.temperature_records (id, plan_id, plan_name, recipe_id, recipe_name, ingredient_id, ingredient_name, tray_index, temperature_c, record_type, user_id, user_name, recorded_at) FROM stdin;
1	3	Production Plan – Tuesday 24 Mar 2026	5	Carnizone	191	Diced Chicken fillet	0	76.0	cooked_core	1	Admin	2026-03-23 15:47:57.691669
2	3	Production Plan – Tuesday 24 Mar 2026	5	Carnizone	191	Diced Chicken fillet	1	75.0	cooked_core	1	Admin	2026-03-23 15:48:09.46353
3	3	Production Plan – Tuesday 24 Mar 2026	5	Carnizone	204	Minced Beef	0	78.0	cooked_core	1	Admin	2026-03-23 15:48:16.292064
4	3	Production Plan – Tuesday 24 Mar 2026	5	Carnizone	204	Minced Beef	1	75.0	cooked_core	1	Admin	2026-03-23 15:48:19.333375
5	3	Production Plan – Tuesday 24 Mar 2026	5	Carnizone	204	Minced Beef	2	78.0	cooked_core	1	Admin	2026-03-23 15:48:21.799165
6	3	Production Plan – Tuesday 24 Mar 2026	5	Carnizone	204	Minced Beef	3	73.0	cooked_core	1	Admin	2026-03-23 15:48:24.944778
7	14	Production Plan – Tuesday 31 Mar 2026	3	BBQ Pulled Pork 	22	Pork	2	60.0	cooked_core	2	Graeme Carter	2026-03-31 14:08:11.852292
8	14	Production Plan – Tuesday 31 Mar 2026	3	BBQ Pulled Pork 	22	Pork	1	60.0	cooked_core	2	Graeme Carter	2026-03-31 14:08:17.156392
9	14	Production Plan – Tuesday 31 Mar 2026	3	BBQ Pulled Pork 	22	Pork	0	60.0	cooked_core	2	Graeme Carter	2026-03-31 14:08:20.46719
\.


--
-- Data for Name: timing_standards; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.timing_standards (id, station_type, station_label, min_batches_per_hour, target_batches_per_hour, updated_at) FROM stdin;
3	mixing	Mixing & Cooking	0.00	0.00	2026-03-19 17:48:17.925737
4	ovens	Ovens	0.00	0.00	2026-03-19 17:48:22.008587
5	wrapping	Wrapping	0.00	0.00	2026-03-19 17:48:26.098471
6	packing	Packing	0.00	0.00	2026-03-19 17:48:30.024824
7	dough_prep	Dough Prep	0.00	0.00	2026-03-19 17:48:34.322213
8	dough_sheeting	Dough Sheeting	0.00	0.00	2026-03-19 17:48:38.420355
9	prep_veg	Prep - Raw Veg	0.00	0.00	2026-03-19 17:48:42.304621
10	prep_bases	Prep - Bases & Mozzarella	0.00	0.00	2026-03-19 17:48:46.595214
11	prep_meat	Prep - Raw Meat	0.00	0.00	2026-03-19 17:48:50.655875
2	building_2	Building 2	9.00	10.00	2026-03-20 12:53:11.527
1	building_1	Building 1	9.00	10.00	2026-03-20 12:53:18.437
\.


--
-- Data for Name: user_invites; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_invites (id, token, email, role, invited_by_id, invited_at, expires_at, accepted_at) FROM stdin;
\.


--
-- Name: andon_issues_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.andon_issues_id_seq', 1, true);


--
-- Name: app_settings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.app_settings_id_seq', 4511, true);


--
-- Name: app_users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.app_users_id_seq', 3, true);


--
-- Name: batch_completions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.batch_completions_id_seq', 1101, true);


--
-- Name: category_defaults_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.category_defaults_id_seq', 1, true);


--
-- Name: daily_stock_checks_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.daily_stock_checks_id_seq', 8, true);


--
-- Name: delivery_check_configs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.delivery_check_configs_id_seq', 1, false);


--
-- Name: delivery_check_results_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.delivery_check_results_id_seq', 1, false);


--
-- Name: delivery_records_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.delivery_records_id_seq', 1, false);


--
-- Name: dispatch_orders_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.dispatch_orders_id_seq', 1, false);


--
-- Name: dpt_ingredient_requirements_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.dpt_ingredient_requirements_id_seq', 1, false);


--
-- Name: dpt_settings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.dpt_settings_id_seq', 10, true);


--
-- Name: founder_custom_panels_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.founder_custom_panels_id_seq', 2, true);


--
-- Name: improvement_submissions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.improvement_submissions_id_seq', 1, true);


--
-- Name: ingredient_storage_locations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ingredient_storage_locations_id_seq', 1, false);


--
-- Name: ingredients_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ingredients_id_seq', 210, true);


--
-- Name: kanban_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.kanban_items_id_seq', 188, true);


--
-- Name: oven_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.oven_events_id_seq', 3, true);


--
-- Name: password_resets_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.password_resets_id_seq', 2, true);


--
-- Name: postcode_validations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.postcode_validations_id_seq', 1, false);


--
-- Name: prep_completions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.prep_completions_id_seq', 46, true);


--
-- Name: production_plan_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.production_plan_items_id_seq', 125, true);


--
-- Name: production_plans_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.production_plans_id_seq', 15, true);


--
-- Name: purchase_order_lines_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.purchase_order_lines_id_seq', 7, true);


--
-- Name: purchase_orders_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.purchase_orders_id_seq', 4, true);


--
-- Name: recipe_ingredients_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.recipe_ingredients_id_seq', 635, true);


--
-- Name: recipe_meat_marinades_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.recipe_meat_marinades_id_seq', 1, false);


--
-- Name: recipe_shopify_mappings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.recipe_shopify_mappings_id_seq', 2, true);


--
-- Name: recipe_sub_recipes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.recipe_sub_recipes_id_seq', 255, true);


--
-- Name: recipes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.recipes_id_seq', 11, true);


--
-- Name: sales_entries_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.sales_entries_id_seq', 1, false);


--
-- Name: station_breaks_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.station_breaks_id_seq', 20, true);


--
-- Name: stock_entries_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.stock_entries_id_seq', 23, true);


--
-- Name: stock_item_categories_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.stock_item_categories_id_seq', 4725, true);


--
-- Name: stock_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.stock_items_id_seq', 1, false);


--
-- Name: stock_transfers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.stock_transfers_id_seq', 4, true);


--
-- Name: storage_locations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.storage_locations_id_seq', 6, true);


--
-- Name: storage_racks_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.storage_racks_id_seq', 1, false);


--
-- Name: sub_recipe_ingredients_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.sub_recipe_ingredients_id_seq', 125, true);


--
-- Name: sub_recipe_sub_recipes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.sub_recipe_sub_recipes_id_seq', 37, true);


--
-- Name: sub_recipes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.sub_recipes_id_seq', 47, true);


--
-- Name: suppliers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.suppliers_id_seq', 26, true);


--
-- Name: temperature_records_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.temperature_records_id_seq', 9, true);


--
-- Name: timing_standards_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.timing_standards_id_seq', 11, true);


--
-- Name: user_invites_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.user_invites_id_seq', 1, false);


--
-- Name: _migrations_done _migrations_done_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._migrations_done
    ADD CONSTRAINT _migrations_done_pkey PRIMARY KEY (key);


--
-- Name: andon_issues andon_issues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.andon_issues
    ADD CONSTRAINT andon_issues_pkey PRIMARY KEY (id);


--
-- Name: app_settings app_settings_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_key_key UNIQUE (key);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (id);


--
-- Name: app_users app_users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_users
    ADD CONSTRAINT app_users_email_key UNIQUE (email);


--
-- Name: app_users app_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_users
    ADD CONSTRAINT app_users_pkey PRIMARY KEY (id);


--
-- Name: batch_completions batch_completions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batch_completions
    ADD CONSTRAINT batch_completions_pkey PRIMARY KEY (id);


--
-- Name: category_defaults category_defaults_category_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.category_defaults
    ADD CONSTRAINT category_defaults_category_key UNIQUE (category);


--
-- Name: category_defaults category_defaults_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.category_defaults
    ADD CONSTRAINT category_defaults_pkey PRIMARY KEY (id);


--
-- Name: daily_stock_checks daily_stock_checks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_stock_checks
    ADD CONSTRAINT daily_stock_checks_pkey PRIMARY KEY (id);


--
-- Name: delivery_check_configs delivery_check_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_check_configs
    ADD CONSTRAINT delivery_check_configs_pkey PRIMARY KEY (id);


--
-- Name: delivery_check_results delivery_check_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_check_results
    ADD CONSTRAINT delivery_check_results_pkey PRIMARY KEY (id);


--
-- Name: delivery_records delivery_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_records
    ADD CONSTRAINT delivery_records_pkey PRIMARY KEY (id);


--
-- Name: dispatch_orders dispatch_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispatch_orders
    ADD CONSTRAINT dispatch_orders_pkey PRIMARY KEY (id);


--
-- Name: dpt_ingredient_requirements dpt_ingredient_requirements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dpt_ingredient_requirements
    ADD CONSTRAINT dpt_ingredient_requirements_pkey PRIMARY KEY (id);


--
-- Name: dpt_settings dpt_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dpt_settings
    ADD CONSTRAINT dpt_settings_pkey PRIMARY KEY (id);


--
-- Name: dpt_settings dpt_settings_recipe_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dpt_settings
    ADD CONSTRAINT dpt_settings_recipe_id_key UNIQUE (recipe_id);


--
-- Name: founder_custom_panels founder_custom_panels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.founder_custom_panels
    ADD CONSTRAINT founder_custom_panels_pkey PRIMARY KEY (id);


--
-- Name: improvement_submissions improvement_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.improvement_submissions
    ADD CONSTRAINT improvement_submissions_pkey PRIMARY KEY (id);


--
-- Name: ingredient_storage_locations ingredient_storage_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingredient_storage_locations
    ADD CONSTRAINT ingredient_storage_locations_pkey PRIMARY KEY (id);


--
-- Name: ingredients ingredients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingredients
    ADD CONSTRAINT ingredients_pkey PRIMARY KEY (id);


--
-- Name: kanban_items kanban_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kanban_items
    ADD CONSTRAINT kanban_items_pkey PRIMARY KEY (id);


--
-- Name: oven_events oven_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oven_events
    ADD CONSTRAINT oven_events_pkey PRIMARY KEY (id);


--
-- Name: page_permissions page_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_permissions
    ADD CONSTRAINT page_permissions_pkey PRIMARY KEY (page_key);


--
-- Name: password_resets password_resets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT password_resets_pkey PRIMARY KEY (id);


--
-- Name: password_resets password_resets_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT password_resets_token_key UNIQUE (token);


--
-- Name: postcode_validations postcode_validations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.postcode_validations
    ADD CONSTRAINT postcode_validations_pkey PRIMARY KEY (id);


--
-- Name: postcode_validations postcode_validations_shopify_order_id_service_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.postcode_validations
    ADD CONSTRAINT postcode_validations_shopify_order_id_service_code_key UNIQUE (shopify_order_id, service_code);


--
-- Name: prep_completions prep_completions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prep_completions
    ADD CONSTRAINT prep_completions_pkey PRIMARY KEY (id);


--
-- Name: production_plan_items production_plan_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_plan_items
    ADD CONSTRAINT production_plan_items_pkey PRIMARY KEY (id);


--
-- Name: production_plans production_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_plans
    ADD CONSTRAINT production_plans_pkey PRIMARY KEY (id);


--
-- Name: purchase_order_lines purchase_order_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_lines
    ADD CONSTRAINT purchase_order_lines_pkey PRIMARY KEY (id);


--
-- Name: purchase_orders purchase_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_pkey PRIMARY KEY (id);


--
-- Name: recipe_ingredients recipe_ingredients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_ingredients
    ADD CONSTRAINT recipe_ingredients_pkey PRIMARY KEY (id);


--
-- Name: recipe_meat_marinades recipe_meat_marinades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_meat_marinades
    ADD CONSTRAINT recipe_meat_marinades_pkey PRIMARY KEY (id);


--
-- Name: recipe_shopify_mappings recipe_shopify_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_shopify_mappings
    ADD CONSTRAINT recipe_shopify_mappings_pkey PRIMARY KEY (id);


--
-- Name: recipe_shopify_mappings recipe_shopify_mappings_recipe_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_shopify_mappings
    ADD CONSTRAINT recipe_shopify_mappings_recipe_id_key UNIQUE (recipe_id);


--
-- Name: recipe_sub_recipes recipe_sub_recipes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_sub_recipes
    ADD CONSTRAINT recipe_sub_recipes_pkey PRIMARY KEY (id);


--
-- Name: recipes recipes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipes
    ADD CONSTRAINT recipes_pkey PRIMARY KEY (id);


--
-- Name: sales_entries sales_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_entries
    ADD CONSTRAINT sales_entries_pkey PRIMARY KEY (id);


--
-- Name: sessions session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT session_pkey PRIMARY KEY (sid);


--
-- Name: sku_locations sku_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sku_locations
    ADD CONSTRAINT sku_locations_pkey PRIMARY KEY (sku);


--
-- Name: station_breaks station_breaks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.station_breaks
    ADD CONSTRAINT station_breaks_pkey PRIMARY KEY (id);


--
-- Name: stock_entries stock_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_entries
    ADD CONSTRAINT stock_entries_pkey PRIMARY KEY (id);


--
-- Name: stock_item_categories stock_item_categories_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_item_categories
    ADD CONSTRAINT stock_item_categories_name_key UNIQUE (name);


--
-- Name: stock_item_categories stock_item_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_item_categories
    ADD CONSTRAINT stock_item_categories_pkey PRIMARY KEY (id);


--
-- Name: stock_items stock_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_items
    ADD CONSTRAINT stock_items_pkey PRIMARY KEY (id);


--
-- Name: stock_transfers stock_transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_pkey PRIMARY KEY (id);


--
-- Name: storage_locations storage_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_locations
    ADD CONSTRAINT storage_locations_pkey PRIMARY KEY (id);


--
-- Name: storage_racks storage_racks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_racks
    ADD CONSTRAINT storage_racks_pkey PRIMARY KEY (id);


--
-- Name: sub_recipe_ingredients sub_recipe_ingredients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sub_recipe_ingredients
    ADD CONSTRAINT sub_recipe_ingredients_pkey PRIMARY KEY (id);


--
-- Name: sub_recipe_sub_recipes sub_recipe_sub_recipes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sub_recipe_sub_recipes
    ADD CONSTRAINT sub_recipe_sub_recipes_pkey PRIMARY KEY (id);


--
-- Name: sub_recipes sub_recipes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sub_recipes
    ADD CONSTRAINT sub_recipes_pkey PRIMARY KEY (id);


--
-- Name: suppliers suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);


--
-- Name: temperature_records temperature_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.temperature_records
    ADD CONSTRAINT temperature_records_pkey PRIMARY KEY (id);


--
-- Name: timing_standards timing_standards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timing_standards
    ADD CONSTRAINT timing_standards_pkey PRIMARY KEY (id);


--
-- Name: timing_standards timing_standards_station_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timing_standards
    ADD CONSTRAINT timing_standards_station_type_key UNIQUE (station_type);


--
-- Name: daily_stock_checks uq_stock_check_ingredient_date; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_stock_checks
    ADD CONSTRAINT uq_stock_check_ingredient_date UNIQUE (ingredient_id, check_date);


--
-- Name: user_invites user_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_invites
    ADD CONSTRAINT user_invites_pkey PRIMARY KEY (id);


--
-- Name: user_invites user_invites_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_invites
    ADD CONSTRAINT user_invites_token_key UNIQUE (token);


--
-- Name: IDX_session_expire; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_session_expire" ON public.sessions USING btree (expire);


--
-- Name: idx_temp_records_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_temp_records_plan ON public.temperature_records USING btree (plan_id);


--
-- Name: idx_temp_records_recorded_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_temp_records_recorded_at ON public.temperature_records USING btree (recorded_at);


--
-- Name: kanban_items_recipe_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX kanban_items_recipe_unique ON public.kanban_items USING btree (recipe_id) WHERE ((source_type = 'recipe'::text) AND (recipe_id IS NOT NULL));


--
-- Name: kanban_items_sub_recipe_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX kanban_items_sub_recipe_unique ON public.kanban_items USING btree (sub_recipe_id) WHERE ((source_type = 'sub_recipe'::text) AND (sub_recipe_id IS NOT NULL));


--
-- Name: recipes_one_current_special; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX recipes_one_current_special ON public.recipes USING btree (is_current_special) WHERE (is_current_special = true);


--
-- Name: uq_prep_completion_ing; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_prep_completion_ing ON public.prep_completions USING btree (plan_id, ingredient_id, recipe_id, tin_number) WHERE (ingredient_id IS NOT NULL);


--
-- Name: uq_prep_completion_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_prep_completion_sub ON public.prep_completions USING btree (plan_id, sub_recipe_id, recipe_id, tin_number) WHERE (sub_recipe_id IS NOT NULL);


--
-- Name: andon_issues andon_issues_acknowledged_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.andon_issues
    ADD CONSTRAINT andon_issues_acknowledged_by_fkey FOREIGN KEY (acknowledged_by) REFERENCES public.app_users(id) ON DELETE SET NULL;


--
-- Name: andon_issues andon_issues_reported_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.andon_issues
    ADD CONSTRAINT andon_issues_reported_by_fkey FOREIGN KEY (reported_by) REFERENCES public.app_users(id) ON DELETE SET NULL;


--
-- Name: andon_issues andon_issues_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.andon_issues
    ADD CONSTRAINT andon_issues_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.app_users(id) ON DELETE SET NULL;


--
-- Name: batch_completions batch_completions_plan_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batch_completions
    ADD CONSTRAINT batch_completions_plan_item_id_fkey FOREIGN KEY (plan_item_id) REFERENCES public.production_plan_items(id) ON DELETE CASCADE;


--
-- Name: batch_completions batch_completions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batch_completions
    ADD CONSTRAINT batch_completions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;


--
-- Name: daily_stock_checks daily_stock_checks_ingredient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_stock_checks
    ADD CONSTRAINT daily_stock_checks_ingredient_id_fkey FOREIGN KEY (ingredient_id) REFERENCES public.ingredients(id) ON DELETE CASCADE;


--
-- Name: daily_stock_checks daily_stock_checks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_stock_checks
    ADD CONSTRAINT daily_stock_checks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;


--
-- Name: delivery_check_configs delivery_check_configs_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_check_configs
    ADD CONSTRAINT delivery_check_configs_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE CASCADE;


--
-- Name: delivery_check_results delivery_check_results_check_config_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_check_results
    ADD CONSTRAINT delivery_check_results_check_config_id_fkey FOREIGN KEY (check_config_id) REFERENCES public.delivery_check_configs(id) ON DELETE CASCADE;


--
-- Name: delivery_check_results delivery_check_results_delivery_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_check_results
    ADD CONSTRAINT delivery_check_results_delivery_record_id_fkey FOREIGN KEY (delivery_record_id) REFERENCES public.delivery_records(id) ON DELETE CASCADE;


--
-- Name: delivery_records delivery_records_purchase_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_records
    ADD CONSTRAINT delivery_records_purchase_order_id_fkey FOREIGN KEY (purchase_order_id) REFERENCES public.purchase_orders(id) ON DELETE SET NULL;


--
-- Name: delivery_records delivery_records_received_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_records
    ADD CONSTRAINT delivery_records_received_by_user_id_fkey FOREIGN KEY (received_by_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;


--
-- Name: delivery_records delivery_records_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_records
    ADD CONSTRAINT delivery_records_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE RESTRICT;


--
-- Name: dispatch_orders dispatch_orders_recipe_id_recipes_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispatch_orders
    ADD CONSTRAINT dispatch_orders_recipe_id_recipes_id_fk FOREIGN KEY (recipe_id) REFERENCES public.recipes(id) ON DELETE RESTRICT;


--
-- Name: dpt_ingredient_requirements dpt_ingredient_requirements_ingredient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dpt_ingredient_requirements
    ADD CONSTRAINT dpt_ingredient_requirements_ingredient_id_fkey FOREIGN KEY (ingredient_id) REFERENCES public.ingredients(id) ON DELETE CASCADE;


--
-- Name: dpt_settings dpt_settings_recipe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dpt_settings
    ADD CONSTRAINT dpt_settings_recipe_id_fkey FOREIGN KEY (recipe_id) REFERENCES public.recipes(id) ON DELETE CASCADE;


--
-- Name: improvement_submissions improvement_submissions_submitted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.improvement_submissions
    ADD CONSTRAINT improvement_submissions_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.app_users(id) ON DELETE SET NULL;


--
-- Name: ingredient_storage_locations ingredient_storage_locations_ingredient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingredient_storage_locations
    ADD CONSTRAINT ingredient_storage_locations_ingredient_id_fkey FOREIGN KEY (ingredient_id) REFERENCES public.ingredients(id) ON DELETE CASCADE;


--
-- Name: ingredient_storage_locations ingredient_storage_locations_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingredient_storage_locations
    ADD CONSTRAINT ingredient_storage_locations_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.storage_locations(id) ON DELETE CASCADE;


--
-- Name: ingredients ingredients_secondary_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingredients
    ADD CONSTRAINT ingredients_secondary_supplier_id_fkey FOREIGN KEY (secondary_supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;


--
-- Name: ingredients ingredients_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingredients
    ADD CONSTRAINT ingredients_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;


--
-- Name: kanban_items kanban_items_ingredient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kanban_items
    ADD CONSTRAINT kanban_items_ingredient_id_fkey FOREIGN KEY (ingredient_id) REFERENCES public.ingredients(id) ON DELETE CASCADE;


--
-- Name: kanban_items kanban_items_pulled_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kanban_items
    ADD CONSTRAINT kanban_items_pulled_by_user_id_fkey FOREIGN KEY (pulled_by_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;


--
-- Name: kanban_items kanban_items_recipe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kanban_items
    ADD CONSTRAINT kanban_items_recipe_id_fkey FOREIGN KEY (recipe_id) REFERENCES public.recipes(id) ON DELETE CASCADE;


--
-- Name: kanban_items kanban_items_sub_recipe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kanban_items
    ADD CONSTRAINT kanban_items_sub_recipe_id_fkey FOREIGN KEY (sub_recipe_id) REFERENCES public.sub_recipes(id) ON DELETE CASCADE;


--
-- Name: kanban_items kanban_items_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kanban_items
    ADD CONSTRAINT kanban_items_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;


--
-- Name: oven_events oven_events_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oven_events
    ADD CONSTRAINT oven_events_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.production_plans(id) ON DELETE CASCADE;


--
-- Name: oven_events oven_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oven_events
    ADD CONSTRAINT oven_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;


--
-- Name: password_resets password_resets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT password_resets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE CASCADE;


--
-- Name: prep_completions prep_completions_ingredient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prep_completions
    ADD CONSTRAINT prep_completions_ingredient_id_fkey FOREIGN KEY (ingredient_id) REFERENCES public.ingredients(id) ON DELETE CASCADE;


--
-- Name: prep_completions prep_completions_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prep_completions
    ADD CONSTRAINT prep_completions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.production_plans(id) ON DELETE CASCADE;


--
-- Name: prep_completions prep_completions_recipe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prep_completions
    ADD CONSTRAINT prep_completions_recipe_id_fkey FOREIGN KEY (recipe_id) REFERENCES public.recipes(id) ON DELETE CASCADE;


--
-- Name: prep_completions prep_completions_sub_recipe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prep_completions
    ADD CONSTRAINT prep_completions_sub_recipe_id_fkey FOREIGN KEY (sub_recipe_id) REFERENCES public.sub_recipes(id);


--
-- Name: prep_completions prep_completions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prep_completions
    ADD CONSTRAINT prep_completions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;


--
-- Name: production_plan_items production_plan_items_plan_id_production_plans_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_plan_items
    ADD CONSTRAINT production_plan_items_plan_id_production_plans_id_fk FOREIGN KEY (plan_id) REFERENCES public.production_plans(id) ON DELETE CASCADE;


--
-- Name: production_plan_items production_plan_items_recipe_id_recipes_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_plan_items
    ADD CONSTRAINT production_plan_items_recipe_id_recipes_id_fk FOREIGN KEY (recipe_id) REFERENCES public.recipes(id) ON DELETE RESTRICT;


--
-- Name: purchase_order_lines purchase_order_lines_ingredient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_lines
    ADD CONSTRAINT purchase_order_lines_ingredient_id_fkey FOREIGN KEY (ingredient_id) REFERENCES public.ingredients(id) ON DELETE RESTRICT;


--
-- Name: purchase_order_lines purchase_order_lines_purchase_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_lines
    ADD CONSTRAINT purchase_order_lines_purchase_order_id_fkey FOREIGN KEY (purchase_order_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;


--
-- Name: purchase_orders purchase_orders_placed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_placed_by_user_id_fkey FOREIGN KEY (placed_by_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;


--
-- Name: purchase_orders purchase_orders_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.production_plans(id) ON DELETE SET NULL;


--
-- Name: purchase_orders purchase_orders_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE RESTRICT;


--
-- Name: recipe_ingredients recipe_ingredients_ingredient_id_ingredients_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_ingredients
    ADD CONSTRAINT recipe_ingredients_ingredient_id_ingredients_id_fk FOREIGN KEY (ingredient_id) REFERENCES public.ingredients(id) ON DELETE RESTRICT;


--
-- Name: recipe_ingredients recipe_ingredients_marinade_for_ingredient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_ingredients
    ADD CONSTRAINT recipe_ingredients_marinade_for_ingredient_id_fkey FOREIGN KEY (marinade_for_ingredient_id) REFERENCES public.ingredients(id) ON DELETE SET NULL;


--
-- Name: recipe_ingredients recipe_ingredients_recipe_id_recipes_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_ingredients
    ADD CONSTRAINT recipe_ingredients_recipe_id_recipes_id_fk FOREIGN KEY (recipe_id) REFERENCES public.recipes(id) ON DELETE CASCADE;


--
-- Name: recipe_meat_marinades recipe_meat_marinades_marinade_ingredient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_meat_marinades
    ADD CONSTRAINT recipe_meat_marinades_marinade_ingredient_id_fkey FOREIGN KEY (marinade_ingredient_id) REFERENCES public.ingredients(id) ON DELETE RESTRICT;


--
-- Name: recipe_meat_marinades recipe_meat_marinades_marinade_sub_recipe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_meat_marinades
    ADD CONSTRAINT recipe_meat_marinades_marinade_sub_recipe_id_fkey FOREIGN KEY (marinade_sub_recipe_id) REFERENCES public.sub_recipes(id) ON DELETE RESTRICT;


--
-- Name: recipe_meat_marinades recipe_meat_marinades_raw_meat_ingredient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_meat_marinades
    ADD CONSTRAINT recipe_meat_marinades_raw_meat_ingredient_id_fkey FOREIGN KEY (raw_meat_ingredient_id) REFERENCES public.ingredients(id) ON DELETE RESTRICT;


--
-- Name: recipe_meat_marinades recipe_meat_marinades_recipe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_meat_marinades
    ADD CONSTRAINT recipe_meat_marinades_recipe_id_fkey FOREIGN KEY (recipe_id) REFERENCES public.recipes(id) ON DELETE CASCADE;


--
-- Name: recipe_shopify_mappings recipe_shopify_mappings_recipe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_shopify_mappings
    ADD CONSTRAINT recipe_shopify_mappings_recipe_id_fkey FOREIGN KEY (recipe_id) REFERENCES public.recipes(id) ON DELETE CASCADE;


--
-- Name: recipe_sub_recipes recipe_sub_recipes_marinade_for_ingredient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_sub_recipes
    ADD CONSTRAINT recipe_sub_recipes_marinade_for_ingredient_id_fkey FOREIGN KEY (marinade_for_ingredient_id) REFERENCES public.ingredients(id) ON DELETE SET NULL;


--
-- Name: recipe_sub_recipes recipe_sub_recipes_recipe_id_recipes_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_sub_recipes
    ADD CONSTRAINT recipe_sub_recipes_recipe_id_recipes_id_fk FOREIGN KEY (recipe_id) REFERENCES public.recipes(id) ON DELETE CASCADE;


--
-- Name: recipe_sub_recipes recipe_sub_recipes_sub_recipe_id_sub_recipes_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_sub_recipes
    ADD CONSTRAINT recipe_sub_recipes_sub_recipe_id_sub_recipes_id_fk FOREIGN KEY (sub_recipe_id) REFERENCES public.sub_recipes(id) ON DELETE RESTRICT;


--
-- Name: sales_entries sales_entries_recipe_id_recipes_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_entries
    ADD CONSTRAINT sales_entries_recipe_id_recipes_id_fk FOREIGN KEY (recipe_id) REFERENCES public.recipes(id) ON DELETE RESTRICT;


--
-- Name: station_breaks station_breaks_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.station_breaks
    ADD CONSTRAINT station_breaks_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.production_plans(id) ON DELETE CASCADE;


--
-- Name: station_breaks station_breaks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.station_breaks
    ADD CONSTRAINT station_breaks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;


--
-- Name: stock_entries stock_entries_ingredient_id_ingredients_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_entries
    ADD CONSTRAINT stock_entries_ingredient_id_ingredients_id_fk FOREIGN KEY (ingredient_id) REFERENCES public.ingredients(id) ON DELETE SET NULL;


--
-- Name: stock_entries stock_entries_recipe_id_recipes_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_entries
    ADD CONSTRAINT stock_entries_recipe_id_recipes_id_fk FOREIGN KEY (recipe_id) REFERENCES public.recipes(id) ON DELETE SET NULL;


--
-- Name: stock_entries stock_entries_stock_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_entries
    ADD CONSTRAINT stock_entries_stock_item_id_fkey FOREIGN KEY (stock_item_id) REFERENCES public.stock_items(id) ON DELETE SET NULL;


--
-- Name: stock_items stock_items_secondary_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_items
    ADD CONSTRAINT stock_items_secondary_supplier_id_fkey FOREIGN KEY (secondary_supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;


--
-- Name: stock_items stock_items_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_items
    ADD CONSTRAINT stock_items_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;


--
-- Name: stock_transfers stock_transfers_ingredient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_ingredient_id_fkey FOREIGN KEY (ingredient_id) REFERENCES public.ingredients(id) ON DELETE SET NULL;


--
-- Name: stock_transfers stock_transfers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;


--
-- Name: storage_racks storage_racks_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_racks
    ADD CONSTRAINT storage_racks_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.storage_locations(id) ON DELETE CASCADE;


--
-- Name: sub_recipe_ingredients sub_recipe_ingredients_ingredient_id_ingredients_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sub_recipe_ingredients
    ADD CONSTRAINT sub_recipe_ingredients_ingredient_id_ingredients_id_fk FOREIGN KEY (ingredient_id) REFERENCES public.ingredients(id) ON DELETE RESTRICT;


--
-- Name: sub_recipe_ingredients sub_recipe_ingredients_sub_recipe_id_sub_recipes_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sub_recipe_ingredients
    ADD CONSTRAINT sub_recipe_ingredients_sub_recipe_id_sub_recipes_id_fk FOREIGN KEY (sub_recipe_id) REFERENCES public.sub_recipes(id) ON DELETE CASCADE;


--
-- Name: sub_recipe_sub_recipes sub_recipe_sub_recipes_component_sub_recipe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sub_recipe_sub_recipes
    ADD CONSTRAINT sub_recipe_sub_recipes_component_sub_recipe_id_fkey FOREIGN KEY (component_sub_recipe_id) REFERENCES public.sub_recipes(id) ON DELETE RESTRICT;


--
-- Name: sub_recipe_sub_recipes sub_recipe_sub_recipes_sub_recipe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sub_recipe_sub_recipes
    ADD CONSTRAINT sub_recipe_sub_recipes_sub_recipe_id_fkey FOREIGN KEY (sub_recipe_id) REFERENCES public.sub_recipes(id) ON DELETE CASCADE;


--
-- Name: temperature_records temperature_records_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.temperature_records
    ADD CONSTRAINT temperature_records_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.production_plans(id) ON DELETE CASCADE;


--
-- Name: temperature_records temperature_records_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.temperature_records
    ADD CONSTRAINT temperature_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;


--
-- Name: user_invites user_invites_invited_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_invites
    ADD CONSTRAINT user_invites_invited_by_id_fkey FOREIGN KEY (invited_by_id) REFERENCES public.app_users(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict rdHgs1dmBlBlSlVAG359V54gxsezO1bMuShMPkSteD6FbARWtpW46wpugqnXo36

